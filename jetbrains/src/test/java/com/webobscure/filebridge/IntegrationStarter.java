package com.webobscure.filebridge;

import com.google.gson.*;
import com.intellij.openapi.application.*;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.project.*;
import com.intellij.openapi.vfs.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public final class IntegrationStarter implements ApplicationStarter {
  @Override public boolean isHeadless() { return true; }
  @Override public int getRequiredModality() { return NOT_IN_EDT; }
  @Override public void main(List<String> args) {
    try {
      JsonObject fixture = JsonParser.parseString(Files.readString(Path.of(args.get(1)))).getAsJsonObject();
      Path root = Path.of(fixture.get("root").getAsString()), projectPath = root.resolve("project");
      Files.createDirectories(projectPath);
      Project project = ProjectManager.getInstance().loadAndOpenProject(projectPath.toString());
      if (project == null) throw new AssertionError("Test project did not open");
      String json = "{\"remotefs.remote\":{\"fixture\":{\"host\":\"127.0.0.1\",\"port\":" + fixture.get("port").getAsInt() +
        ",\"username\":\"tester\",\"password\":\"test-password\",\"rootPath\":\"/public_html\",\"connectTimeout\":3000}}}";
      ConfigStore.get().json(json);
      var profile = ConfigStore.get().profiles().getFirst();
      Path remote = root.resolve("public_html/ide-save.php"), local = projectPath.resolve("ide-save.php");
      Files.writeString(remote, "<?php echo 'original';\n"); Files.writeString(local, Files.readString(remote));
      ConfigStore.Binding binding = new ConfigStore.Binding();
      binding.cachePath = local.toString(); binding.profileId = profile.id(); binding.remotePath = "/ide-save.php";
      try (var ftp = new FtpTransport(profile, "test-password")) { binding.version = ftp.stat(binding.remotePath).version(); }
      ConfigStore.get().remember(binding);
      Document[] document = new Document[1];
      ApplicationManager.getApplication().invokeAndWait(() -> {
        VirtualFile file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(local);
        document[0] = FileDocumentManager.getInstance().getDocument(file);
        if (document[0] == null) throw new AssertionError("Document missing");
        WriteCommandAction.runWriteCommandAction(project, () -> document[0].setText("<?php echo 'saved from PhpStorm';\n"));
        FileDocumentManager.getInstance().saveDocument(document[0]);
      });
      barrier(project, profile.id());
      if (!Files.readString(remote).contains("saved from PhpStorm")) throw new AssertionError("Save did not reach server");
      ApplicationManager.getApplication().invokeAndWait(() -> {
        if (FileDocumentManager.getInstance().isDocumentUnsaved(document[0])) throw new AssertionError("Successful save stays dirty");
        SettingsPanel panel = new SettingsPanel(); panel.createComponent(); panel.reset(); panel.disposeUIResources();
        if (!new TabTitle().getEditorTabTitle(project, FileDocumentManager.getInstance().getFile(document[0])).contains("fixture")) throw new AssertionError("Remote tab title missing");
      });
      System.out.println("PASS native editor Save uploads and marks document clean");
      Files.writeString(root.resolve("reject-upload"), "1");
      ApplicationManager.getApplication().invokeAndWait(() -> {
        WriteCommandAction.runWriteCommandAction(project, () -> document[0].setText("<?php echo 'unsent changes';\n"));
        FileDocumentManager.getInstance().saveDocument(document[0]);
      });
      barrier(project, profile.id());
      ApplicationManager.getApplication().invokeAndWait(() -> {
        if (!FileDocumentManager.getInstance().isDocumentUnsaved(document[0])) throw new AssertionError("Failed save lost dirty state");
      });
      if (!Files.readString(remote).contains("saved from PhpStorm") || !Files.readString(Path.of(local + ".unsent")).contains("unsent changes")) throw new AssertionError("Failure recovery missing");
      System.out.println("PASS failed save retains dirty edits and recovery copy");
      Files.delete(root.resolve("reject-upload"));
      ApplicationManager.getApplication().invokeAndWait(() -> FileDocumentManager.getInstance().saveDocument(document[0]));
      barrier(project, profile.id());
      if (!Files.readString(remote).contains("unsent changes")) throw new AssertionError("Retry did not upload");
      System.out.println("PASS explicit retry saves to server");
      Files.writeString(Path.of(fixture.get("report").getAsString()), "Native PhpStorm editor integration: 3 checks passed\n");
      System.exit(0);
    } catch (Throwable error) { error.printStackTrace(); System.exit(1); }
  }
  private static void barrier(Project project, String id) throws Exception {
    CompletableFuture<Boolean> future = new CompletableFuture<>();
    RemoteManager.get().run(project, id, ftp -> true, future::complete);
    future.get(20, TimeUnit.SECONDS);
  }
}
