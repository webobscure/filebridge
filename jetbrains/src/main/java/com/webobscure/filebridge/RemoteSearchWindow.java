package com.webobscure.filebridge;

import com.intellij.ide.passwordSafe.PasswordSafe;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import javax.swing.*;
import javax.swing.tree.*;
import java.awt.*;
import java.awt.event.*;
import java.io.*;
import java.util.*;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

public final class RemoteSearchWindow extends DialogWrapper {
  private final Project project;
  private final String profileId, folder;
  private final JPanel panel = new JPanel(new BorderLayout(8, 8));
  private final JTextField query = new JTextField(), exclude = new JTextField();
  private final JCheckBox matchCase = new JCheckBox("Match case");
  private final JSpinner maxMB = new JSpinner(new SpinnerNumberModel(10, 1, 128, 1));
  private final JSpinner maxResults = new JSpinner(new SpinnerNumberModel(1000, 1, 50000, 100));
  private final JButton start = new JButton("Search"), stop = new JButton("Cancel Search");
  private final JTextArea status = new JTextArea("Search reads UTF-8 files from the server, including unopened files. No files are uploaded.");
  private final DefaultMutableTreeNode root = new DefaultMutableTreeNode("Results");
  private final DefaultTreeModel model = new DefaultTreeModel(root);
  private final JTree tree = new JTree(model);
  private final Map<String, DefaultMutableTreeNode> files = new LinkedHashMap<>();
  private final AtomicBoolean cancelled = new AtomicBoolean();
  private volatile FtpTransport active;
  private boolean running, closed;

  public RemoteSearchWindow(Project project, String profileId, String folder) {
    super(project);
    this.project = project; this.profileId = profileId; this.folder = folder;
    setTitle("FileBridge: Search Remote Files — " + folder); setModal(false); setCancelButtonText("Close");
    JPanel fields = new JPanel(new GridLayout(0, 2, 8, 5));
    fields.add(new JLabel("Find text")); fields.add(query);
    fields.add(new JLabel("Exclude names/relative paths (comma separated, no wildcards)")); fields.add(exclude);
    fields.add(new JLabel("Maximum file size (MiB)")); fields.add(maxMB);
    fields.add(new JLabel("Maximum matches")); fields.add(maxResults);
    JPanel actions = new JPanel(new FlowLayout(FlowLayout.LEFT));
    actions.add(matchCase); actions.add(start); actions.add(stop); stop.setEnabled(false);
    JPanel north = new JPanel(new BorderLayout()); north.add(fields, BorderLayout.CENTER); north.add(actions, BorderLayout.SOUTH);
    panel.add(north, BorderLayout.NORTH); panel.add(new JScrollPane(tree), BorderLayout.CENTER);
    status.setEditable(false); status.setLineWrap(true); status.setWrapStyleWord(true); status.setRows(3);
    panel.add(new JScrollPane(status), BorderLayout.SOUTH); panel.setPreferredSize(new Dimension(880, 580));
    tree.setRootVisible(false); tree.setShowsRootHandles(true);
    tree.addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent event) { if (event.getClickCount() == 2) open(); } });
    tree.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "open-match");
    tree.getActionMap().put("open-match", new AbstractAction() { @Override public void actionPerformed(ActionEvent event) { open(); } });
    start.addActionListener(event -> search()); query.addActionListener(event -> search()); stop.addActionListener(event -> cancel());
    init();
  }
  @Override protected JComponent createCenterPanel() { return panel; }
  @Override protected Action[] createActions() { return new Action[]{getCancelAction()}; }
  @Override public JComponent getPreferredFocusedComponent() { return query; }
  private void ui(Runnable work) {
    ApplicationManager.getApplication().invokeLater(() -> { if (!closed && !project.isDisposed()) work.run(); });
  }
  private void open() {
    Object selection = tree.getLastSelectedPathComponent();
    if (selection instanceof DefaultMutableTreeNode node && node.getUserObject() instanceof RemoteSearch.Match hit) {
      RemoteManager.get().open(project, profileId, hit.path(), hit.line(), hit.column());
    }
  }
  private void cancel() {
    cancelled.set(true); stop.setEnabled(false); status.setText("Cancelling search…");
    FtpTransport transport = active;
    if (transport != null) ApplicationManager.getApplication().executeOnPooledThread(transport::close);
  }
  private void search() {
    if (running) return;
    RemoteSearch.Options options;
    try {
      List<String> rules = exclude.getText().isBlank() ? List.of() : Arrays.stream(exclude.getText().split(",", -1)).map(String::trim).toList();
      options = new RemoteSearch.Options(query.getText(), matchCase.isSelected(), rules, ((Number)maxMB.getValue()).intValue() * 1024 * 1024, ((Number)maxResults.getValue()).intValue());
    } catch (IllegalArgumentException error) { status.setText(error.getMessage()); return; }
    root.removeAllChildren(); files.clear(); model.reload(); cancelled.set(false); running = true;
    start.setEnabled(false); stop.setEnabled(true); status.setText("Connecting to the server…");
    ApplicationManager.getApplication().executeOnPooledThread(() -> {
      try {
        Profiles.Profile profile = ConfigStore.get().profile(profileId);
        String password = profile.password();
        if (password == null) password = PasswordSafe.getInstance().getPassword(RemoteManager.credentials(profileId));
        if (password == null) throw new IOException("No password is saved. Use Password in the FileBridge tool window.");
        String secret = password;
        RemoteSearch.Source source = new RemoteSearch.Source() {
          private FtpTransport connection() throws IOException {
            if (cancelled.get()) throw new InterruptedIOException("Search cancelled.");
            if (active == null || !active.isConnected()) {
              try { active = new FtpTransport(profile, secret); }
              catch (Exception error) { throw new IOException("Could not connect. Check the address, password, FTP/FTPS mode, and certificate."); }
            }
            if (cancelled.get()) { active.close(); throw new InterruptedIOException("Search cancelled."); }
            return active;
          }
          public List<FtpTransport.Entry> list(String path) throws IOException {
            FtpTransport ftp = connection();
            try { return ftp.list(path); } catch (IOException error) { ftp.close(); throw error; }
          }
          public byte[] read(String path, int limit) throws IOException { return connection().readSearch(path, limit, cancelled::get); }
        };
        RemoteSearch.Summary summary = RemoteSearch.search(source, folder, options, cancelled::get, hit -> ui(() -> {
          DefaultMutableTreeNode file = files.get(hit.path());
          if (file == null) { file = new DefaultMutableTreeNode(hit.path()); files.put(hit.path(), file); model.insertNodeInto(file, root, root.getChildCount()); }
          model.insertNodeInto(new DefaultMutableTreeNode(hit), file, file.getChildCount());
          if (file.getChildCount() == 1) tree.expandPath(new TreePath(file.getPath()));
        }), (summarySoFar, path) -> {
          String text = "Searching: " + summarySoFar.scanned + " files · " + summarySoFar.matches + " matches · " + path;
          ui(() -> status.setText(text));
        });
        ui(() -> {
          status.setText(summary + (summary.limited ? ". Narrow the query or increase Maximum matches." : ""));
          status.setToolTipText(status.getText());
          for (String issue : summary.issues) model.insertNodeInto(new DefaultMutableTreeNode(issue), root, root.getChildCount());
        });
      } catch (Exception error) { ui(() -> status.setText(cancelled.get() ? "Search cancelled." : error.getMessage())); }
      finally {
        FtpTransport transport = active; if (transport != null) transport.close(); active = null;
        ui(() -> { running = false; start.setEnabled(true); stop.setEnabled(false); });
      }
    });
  }
  @Override protected void dispose() { closed = true; cancel(); super.dispose(); }
}
