package com.webobscure.filebridge;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.options.ShowSettingsUtil;
import com.intellij.openapi.project.*;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.wm.*;
import com.intellij.ui.content.Content;
import javax.swing.*;
import javax.swing.event.*;
import javax.swing.tree.*;
import java.awt.*;
import java.awt.event.*;
import java.util.List;

public final class FileBridgeWindow implements ToolWindowFactory, DumbAware {
  @Override public void createToolWindowContent(Project project, ToolWindow window) {
    Panel panel = new Panel(project);
    Content content = window.getContentManager().getFactory().createContent(panel, "", false);
    content.setDisposer(panel); window.getContentManager().addContent(content);
  }
  private record Node(String id, String path, String name, boolean directory, boolean link) {
    @Override public String toString() { return name + (link ? " [link]" : ""); }
  }
  private static final class Panel extends JPanel implements Disposable {
    private final Project project;
    private final JTree tree = new JTree();
    private DefaultTreeModel model;
    private boolean disposed;
    Panel(Project project) {
      super(new BorderLayout()); this.project = project;
      JToolBar toolbar = new JToolBar(); toolbar.setFloatable(false);
      button(toolbar, "Settings", () -> { ShowSettingsUtil.getInstance().showSettingsDialog(project, SettingsPanel.class); refresh(); });
      button(toolbar, "Refresh", this::refresh);
      button(toolbar, "Search", this::search);
      button(toolbar, "Password", this::password);
      button(toolbar, "+ File", () -> create(false));
      button(toolbar, "+ Folder", () -> create(true));
      button(toolbar, "Rename", this::rename);
      button(toolbar, "Delete", this::delete);
      add(toolbar, BorderLayout.NORTH); add(new JScrollPane(tree), BorderLayout.CENTER);
      add(new JLabel(" Save explicitly (Cmd+S / Ctrl+S) to upload; autosave does not upload."), BorderLayout.SOUTH);
      tree.setRootVisible(false); tree.setShowsRootHandles(true);
      tree.addTreeWillExpandListener(new TreeWillExpandListener() {
        @Override public void treeWillCollapse(TreeExpansionEvent event) {}
        @Override public void treeWillExpand(TreeExpansionEvent event) {
          DefaultMutableTreeNode node = (DefaultMutableTreeNode)event.getPath().getLastPathComponent();
          if (node.getUserObject() instanceof Node remote && node.getChildCount() == 1 &&
              ((DefaultMutableTreeNode)node.getFirstChild()).getUserObject() instanceof String) load(node, remote);
        }
      });
      tree.addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent event) { if (event.getClickCount() == 2) open(); } });
      tree.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "filebridge.open");
      tree.getActionMap().put("filebridge.open", new AbstractAction() { @Override public void actionPerformed(ActionEvent event) { open(); } });
      refresh();
    }
    private void button(JToolBar toolbar, String title, Runnable action) {
      JButton button = new JButton(title); button.addActionListener(event -> action.run()); toolbar.add(button);
    }
    private void refresh() {
      DefaultMutableTreeNode root = new DefaultMutableTreeNode("FileBridge");
      try {
        for (Profiles.Profile profile : ConfigStore.get().profiles()) {
          root.add(node(new Node(profile.id(), "/", profile.name() + " — " + profile.host() + ":" + profile.port(), true, false)));
        }
      } catch (Exception error) { root.add(new DefaultMutableTreeNode("Invalid configuration — open Settings")); }
      if (root.getChildCount() == 0) root.add(new DefaultMutableTreeNode("Open Settings to add FTP/FTPS connections"));
      model = new DefaultTreeModel(root); tree.setModel(model);
    }
    private DefaultMutableTreeNode node(Node remote) {
      DefaultMutableTreeNode value = new DefaultMutableTreeNode(remote);
      if (remote.directory && !remote.link) value.add(new DefaultMutableTreeNode("Expand to load"));
      return value;
    }
    private void load(DefaultMutableTreeNode node, Node remote) {
      if (remote.link) return;
      RemoteManager.get().run(project, remote.id, ftp -> ftp.list(remote.path), entries -> {
        if (disposed || node.getRoot() != model.getRoot()) return;
        node.removeAllChildren();
        for (FtpTransport.Entry entry : entries) node.add(node(new Node(remote.id,
          Profiles.path("/", remote.path + "/" + entry.name()), entry.name(), entry.directory(), entry.link())));
        model.nodeStructureChanged(node); tree.expandPath(new TreePath(node.getPath()));
      });
    }
    private Node selected() {
      Object selected = tree.getLastSelectedPathComponent();
      return selected instanceof DefaultMutableTreeNode node && node.getUserObject() instanceof Node remote ? remote : null;
    }
    private void search() {
      Node remote = selected();
      if (remote == null) { RemoteManager.notify(project, "Select a server or folder to search first.", false); return; }
      if (remote.link) { RemoteManager.notify(project, "Symbolic links are not searched.", false); return; }
      new RemoteSearchWindow(project, remote.id, remote.directory ? remote.path : parent(remote.path)).show();
    }
    private void open() {
      Node remote = selected(); if (remote == null) return;
      if (remote.link) { RemoteManager.notify(project, "Symbolic links are not supported yet.", true); return; }
      if (remote.directory) tree.expandPath(tree.getSelectionPath());
      else RemoteManager.get().open(project, remote.id, remote.path);
    }
    private void password() {
      Node remote = selected(); if (remote == null) { RemoteManager.notify(project, "Select a server or one of its files first.", false); return; }
      if (ConfigStore.get().profile(remote.id).password() != null) {
        RemoteManager.notify(project, "Edit password in JSON, or remove that field to use secure storage.", false); return;
      }
      String password = Messages.showPasswordDialog(project, "Save a password in the IDE's secure storage", "FileBridge Password", null);
      if (password != null && !password.matches("(?s).*[\\r\\n\\x00].*")) RemoteManager.get().password(project, remote.id, password);
    }
    private String name(String title, String initial) {
      String value = Messages.showInputDialog(project, "Name (without slashes)", title, null, initial, null);
      if (value == null) return null;
      if (!Profiles.clean(value) || value.contains("/") || value.contains("\\") || List.of(".", "..").contains(value)) {
        RemoteManager.notify(project, "Enter a valid file or folder name.", true); return null;
      }
      return value;
    }
    private void create(boolean folder) {
      Node remote = selected(); if (remote == null) return;
      String name = name(folder ? "New Remote Folder" : "New Remote File", ""); if (name == null) return;
      String parent = remote.directory ? remote.path : parent(remote.path);
      String path = Profiles.path("/", parent + "/" + name);
      RemoteManager.get().run(project, remote.id, ftp -> {
        if (folder) ftp.mkdir(path); else ftp.write(path, new byte[0], null);
        return path;
      }, result -> { refresh(); if (!folder) RemoteManager.get().open(project, remote.id, result); });
    }
    private boolean canChange(Node remote) {
      if (remote.path.equals("/")) { RemoteManager.notify(project, "The connection root cannot be renamed or deleted.", true); return false; }
      for (var file : FileEditorManager.getInstance(project).getOpenFiles()) {
        ConfigStore.Binding binding = ConfigStore.get().binding(file.getPath());
        if (binding != null && binding.profileId.equals(remote.id) &&
            (binding.remotePath.equals(remote.path) || binding.remotePath.startsWith(remote.path + "/"))) {
          RemoteManager.notify(project, "Save and close the affected editor tabs before renaming or deleting this item.", true); return false;
        }
      }
      return true;
    }
    private String parent(String path) { int index = path.lastIndexOf('/'); return index <= 0 ? "/" : path.substring(0, index); }
    private void rename() {
      Node remote = selected(); if (remote == null || !canChange(remote)) return;
      String name = name("Rename Remote Item", remote.name); if (name == null) return;
      String target = Profiles.path("/", parent(remote.path) + "/" + name);
      RemoteManager.get().run(project, remote.id, ftp -> { ftp.rename(remote.path, target); return true; }, ignored -> refresh());
    }
    private void delete() {
      Node remote = selected(); if (remote == null || !canChange(remote)) return;
      if (Messages.showYesNoDialog(project, "Delete " + remote.path + " from the server? This cannot be undone.",
          "Delete Remote Item", Messages.getWarningIcon()) != Messages.YES) return;
      RemoteManager.get().run(project, remote.id, ftp -> { ftp.delete(remote.path); return true; }, ignored -> refresh());
    }
    @Override public void dispose() { disposed = true; }
  }
}
