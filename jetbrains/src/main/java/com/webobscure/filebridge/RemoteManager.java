package com.webobscure.filebridge;

import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.ide.passwordSafe.PasswordSafe;
import com.intellij.notification.*;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.*;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Key;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

@Service(Service.Level.APP)
public final class RemoteManager implements Disposable {
  public static final Key<Boolean> LOCAL_SAVE = Key.create("filebridge.local-save");
  private final Map<String, ExecutorService> queues = new ConcurrentHashMap<>();
  private final Set<String> pending = ConcurrentHashMap.newKeySet();
  private final Map<String, Project> owners = new ConcurrentHashMap<>();
  public static RemoteManager get() { return ApplicationManager.getApplication().getService(RemoteManager.class); }
  @FunctionalInterface public interface Work<T> { T run(FtpTransport transport) throws Exception; }
  private ExecutorService queue(String id) {
    return queues.computeIfAbsent(id, ignored -> Executors.newSingleThreadExecutor(work -> {
      Thread thread = new Thread(work, "FileBridge FTP"); thread.setDaemon(true); return thread;
    }));
  }
  public static CredentialAttributes credentials(String id) { return new CredentialAttributes("FileBridge " + id); }
  public <T> void run(Project project, String id, Work<T> work, Consumer<T> success) {
    queue(id).execute(() -> {
      try {
        Profiles.Profile profile = ConfigStore.get().profile(id);
        String password = profile.password();
        if (password == null) password = PasswordSafe.getInstance().getPassword(credentials(id));
        if (password == null) throw new IOException("No password is saved. Select the server and click Password, or set password in JSON.");
        T value;
        try (FtpTransport transport = new FtpTransport(profile, password)) { value = work.run(transport); }
        ApplicationManager.getApplication().invokeLater(() -> { if (!project.isDisposed()) success.accept(value); });
      } catch (Exception error) { notify(project, error.getMessage() == null ? "Connection failed. Check the server address, port, and TLS certificate." : error.getMessage(), true); }
    });
  }
  public static void notify(Project project, String message, boolean error) {
    String escaped = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    NotificationGroupManager.getInstance().getNotificationGroup("FileBridge")
      .createNotification(escaped, error ? NotificationType.ERROR : NotificationType.INFORMATION).notify(project);
  }
  public void password(Project project, String id, String password) {
    queue(id).execute(() -> {
      try { PasswordSafe.getInstance().setPassword(credentials(id), password); notify(project, "Password saved in the IDE's secure storage.", false); }
      catch (Exception error) { notify(project, "Could not save the password in secure storage.", true); }
    });
  }
  private record Download(byte[] bytes, String version, byte[] recovery) {}
  private void owner(String path, Project project) {
    if (owners.put(path, project) != project) Disposer.register(project, () -> owners.remove(path, project));
  }
  public void open(Project project, String profileId, String remotePath) {
    open(project, profileId, remotePath, 0, 0);
  }
  public void open(Project project, String profileId, String remotePath, int line, int column) {
    String name = remotePath.substring(remotePath.lastIndexOf('/') + 1);
    Path cache = Path.of(PathManager.getSystemPath(), "filebridge", profileId, Profiles.hash(remotePath), name);
    VirtualFile existing = LocalFileSystem.getInstance().findFileByNioFile(cache);
    if (existing != null) {
      Document doc = FileDocumentManager.getInstance().getCachedDocument(existing);
      if (doc != null && FileDocumentManager.getInstance().isDocumentUnsaved(doc)) {
        owner(existing.getPath(), project);
        FileEditorManager.getInstance(project).openTextEditor(new OpenFileDescriptor(project, existing, line, column), true); return;
      }
    }
    run(project, profileId, transport -> {
      FtpTransport.Entry before = transport.stat(remotePath);
      if (before == null) throw new IOException("File not found.");
      byte[] bytes = transport.read(remotePath);
      try { StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)); }
      catch (CharacterCodingException invalid) { throw new IOException("This version supports UTF-8 text files only."); }
      for (byte value : bytes) if (value == 0) throw new IOException("Binary files cannot be edited in FileBridge.");
      Files.createDirectories(cache.getParent());
      if (!Files.exists(cache)) Files.write(cache, bytes, StandardOpenOption.CREATE_NEW);
      Path recovery = Path.of(cache + ".unsent");
      byte[] unsent = Files.exists(recovery) && Files.size(recovery) <= 32 * 1024 * 1024 ? Files.readAllBytes(recovery) : null;
      return new Download(bytes, before.version(), unsent);
    }, download -> {
      VirtualFile file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(cache);
      if (file == null) { notify(project, "Could not open the editor cache.", true); return; }
      Document doc = FileDocumentManager.getInstance().getCachedDocument(file);
      if (doc != null && FileDocumentManager.getInstance().isDocumentUnsaved(doc)) {
        FileEditorManager.getInstance(project).openTextEditor(new OpenFileDescriptor(project, file, line, column), true); return;
      }
      boolean restore = false;
      ConfigStore.Binding previous = ConfigStore.get().binding(file.getPath());
      if (download.recovery() != null) {
        int answer = Messages.showYesNoCancelDialog(project,
          "Unsent edits were recovered for " + remotePath + ". Restore them for review before retrying the upload?",
          "FileBridge Recovery", "Restore Unsent Edits", "Use Server Version", "Cancel", Messages.getQuestionIcon());
        if (answer == Messages.CANCEL) return;
        restore = answer == Messages.YES;
      }
      try {
        WriteAction.run(() -> file.setBinaryContent(download.bytes()));
        ConfigStore.Binding binding = new ConfigStore.Binding();
        binding.cachePath = file.getPath(); binding.profileId = profileId; binding.remotePath = remotePath;
        binding.version = restore && previous != null ? previous.version : download.version();
        binding.newline = new String(download.bytes(), StandardCharsets.UTF_8).contains("\r\n") ? "\r\n" : "\n";
        binding.bom = download.bytes().length >= 3 && download.bytes()[0] == (byte)0xef && download.bytes()[1] == (byte)0xbb && download.bytes()[2] == (byte)0xbf;
        ConfigStore.get().remember(binding);
        owner(file.getPath(), project);
        file.setCharset(StandardCharsets.UTF_8);
        Document loaded = FileDocumentManager.getInstance().getCachedDocument(file);
        if (loaded != null) FileDocumentManager.getInstance().reloadFromDisk(loaded);
        FileEditorManager.getInstance(project).openTextEditor(new OpenFileDescriptor(project, file, line, column), true);
        if (restore) {
          Document recovered = FileDocumentManager.getInstance().getDocument(file);
          String text = new String(download.recovery(), StandardCharsets.UTF_8).replace("\r\n", "\n");
          if (binding.bom && text.startsWith("\ufeff")) text = text.substring(1);
          String content = text;
          if (recovered != null) WriteCommandAction.runWriteCommandAction(project, () -> recovered.setText(content));
          notify(project, "Recovered unsent edits. Review them and save explicitly to retry the upload.", false);
        } else {
          queue(profileId).execute(() -> { try { Files.deleteIfExists(Path.of(cache + ".unsent")); } catch (IOException ignored) {} });
        }
      } catch (IOException error) { notify(project, "Could not update the editor cache.", true); }
    });
  }
  public boolean save(Document document, boolean explicit) {
    VirtualFile file = FileDocumentManager.getInstance().getFile(document);
    if (file == null || Boolean.TRUE.equals(document.getUserData(LOCAL_SAVE))) return true;
    ConfigStore.Binding binding = ConfigStore.get().binding(file.getPath());
    if (binding == null) return true;
    // Keep documents dirty during the transfer and after any failure. Autosave never uploads.
    if (!explicit) return false;
    long stamp = document.getModificationStamp();
    String key = file.getPath() + ":" + stamp;
    if (!pending.add(key)) return false;
    String text = document.getText().replace("\n", binding.newline);
    if (binding.bom && !text.startsWith("\ufeff")) text = "\ufeff" + text;
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    Project selected = owners.get(file.getPath());
    Project project = selected != null && !selected.isDisposed() ? selected : com.intellij.openapi.project.ProjectLocator.getInstance().guessProjectForFile(file);
    if (project == null) { pending.remove(key); return false; }
    queue(binding.profileId).execute(() -> {
      try {
        // Keep a recovery copy even if the FTP transfer fails; never add files to the local project.
        Files.write(Path.of(file.getPath() + ".unsent"), bytes);
        Profiles.Profile profile = ConfigStore.get().profile(binding.profileId);
        String password = profile.password();
        if (password == null) password = PasswordSafe.getInstance().getPassword(credentials(profile.id()));
        if (password == null) throw new IOException("No password is saved for this server.");
        String version;
        try (FtpTransport transport = new FtpTransport(profile, password)) {
          version = transport.write(binding.remotePath, bytes, binding.version);
        }
        binding.version = version;
        try { Files.deleteIfExists(Path.of(file.getPath() + ".unsent")); } catch (IOException ignored) {}
        ApplicationManager.getApplication().invokeLater(() -> {
          if (project.isDisposed()) return;
          if (document.getModificationStamp() == stamp) {
            document.putUserData(LOCAL_SAVE, true);
            try { FileDocumentManager.getInstance().saveDocument(document); }
            finally { document.putUserData(LOCAL_SAVE, null); }
          }
          notify(project, "Uploaded " + binding.remotePath, false);
        });
      } catch (Exception error) {
        notify(project, "Upload failed for " + binding.remotePath + ". Your edits remain unsaved. " +
          (error.getMessage() == null ? "Check the connection and TLS certificate." : error.getMessage()), true);
      } finally { pending.remove(key); }
    });
    return false;
  }
  @Override public void dispose() { for (ExecutorService queue : queues.values()) queue.shutdownNow(); queues.clear(); owners.clear(); }
}
