package com.webobscure.filebridge;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileDocumentSynchronizationVetoer;

public final class SaveVetoer extends FileDocumentSynchronizationVetoer {
  @Override public boolean maySaveDocument(Document document, boolean explicit) {
    return RemoteManager.get().save(document, explicit);
  }
}
