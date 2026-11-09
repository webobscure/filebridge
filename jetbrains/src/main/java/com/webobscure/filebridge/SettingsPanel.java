package com.webobscure.filebridge;

import com.intellij.openapi.options.*;
import javax.swing.*;
import java.awt.*;

public final class SettingsPanel implements Configurable {
  private JTextArea json;
  @Override public String getDisplayName() { return "FileBridge"; }
  @Override public JComponent createComponent() {
    JPanel panel = new JPanel(new BorderLayout(0, 12));
    json = new JTextArea(24, 72); json.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
    panel.add(new JLabel("<html>FTP/FTPS connections in the same <b>remotefs.remote</b> JSON format as FileBridge for VS Code.<br>" +
      "An explicit password is stored as plain text. Omit it and use Password in the FileBridge panel for secure storage.<br>" +
      "Use explicit Save (Cmd+S / Ctrl+S) to upload. IDE autosave does not upload remote files.</html>"), BorderLayout.NORTH);
    panel.add(new JScrollPane(json), BorderLayout.CENTER); reset(); return panel;
  }
  @Override public boolean isModified() { return json != null && !json.getText().equals(ConfigStore.get().json()); }
  @Override public void apply() throws ConfigurationException {
    try { ConfigStore.get().json(json.getText()); }
    catch (IllegalArgumentException error) { throw new ConfigurationException(error.getMessage()); }
  }
  @Override public void reset() { if (json != null) json.setText(ConfigStore.get().json()); }
  @Override public void disposeUIResources() { json = null; }
}
