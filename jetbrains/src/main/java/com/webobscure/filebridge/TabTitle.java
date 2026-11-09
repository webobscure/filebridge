package com.webobscure.filebridge;
import com.intellij.openapi.fileEditor.impl.EditorTabTitleProvider;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;

public final class TabTitle implements EditorTabTitleProvider {
  @Override public String getEditorTabTitle(Project project, VirtualFile file) {
    ConfigStore.Binding binding = ConfigStore.get().binding(file.getPath());
    if (binding == null) return null;
    try { return file.getName() + " [" + ConfigStore.get().profile(binding.profileId).name() + "]"; }
    catch (Exception removed) { return file.getName() + " [FileBridge]"; }
  }
}
