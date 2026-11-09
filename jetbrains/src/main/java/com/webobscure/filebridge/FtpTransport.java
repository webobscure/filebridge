package com.webobscure.filebridge;

import org.apache.commons.net.ftp.*;
import javax.net.ssl.*;
import java.io.*;
import java.time.Duration;
import java.security.KeyStore;
import java.util.*;
import com.webobscure.filebridge.Profiles.Profile;

public final class FtpTransport implements AutoCloseable {
  private final FTPClient client;
  private final Profile profile;
  public record Entry(String name, boolean directory, boolean link, long size, long modified) {
    public String version() { return size + ":" + modified; }
  }
  public FtpTransport(Profile profile, String password) throws Exception {
    this.profile = profile;
    if (profile.scheme().equals("ftp")) client = new FTPClient();
    else {
      FTPSClient tls = new FTPSClient(profile.scheme().equals("ftps-implicit"));
      TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      factory.init((KeyStore)null);
      for (TrustManager manager : factory.getTrustManagers()) {
        if (manager instanceof X509TrustManager x509) { tls.setTrustManager(x509); break; }
      }
      tls.setEndpointCheckingEnabled(true);
      client = tls;
    }
    client.setControlEncoding("UTF-8");
    client.setListHiddenFiles(true);
    client.setAutodetectUTF8(true);
    client.setConnectTimeout(profile.timeout());
    client.setDefaultTimeout(profile.timeout());
    client.setDataTimeout(Duration.ofMillis(profile.timeout()));
    client.setIpAddressFromPasvResponse(false);
    try {
      client.connect(profile.host(), profile.port());
      client.setSoTimeout(profile.timeout());
      check(FTPReply.isPositiveCompletion(client.getReplyCode()), "connect");
      check(client.login(profile.username(), password), "sign in");
      if (client instanceof FTPSClient tls) { tls.execPBSZ(0); tls.execPROT("P"); }
      client.enterLocalPassiveMode();
      check(client.setFileType(FTP.BINARY_FILE_TYPE), "set binary mode");
    } catch (Exception e) { close(); throw e; }
  }
  private void check(boolean success, String action) throws IOException {
    if (!success) throw new IOException("FTP " + client.getReplyCode() + ": could not " + action + ". Check the connection, path, and permissions.");
  }
  private String absolute(String path) { return Profiles.path(profile.rootPath(), path); }
  public List<Entry> list(String path) throws IOException {
    check(client.changeWorkingDirectory(absolute(path)), "open folder");
    FTPFile[] files = client.listFiles();
    if (List.of(500, 501, 502, 504).contains(client.getReplyCode()) && client.getListHiddenFiles()) {
      // Some non-Unix servers reject LIST flags and already include hidden files.
      client.setListHiddenFiles(false); files = client.listFiles();
    }
    check(FTPReply.isPositiveCompletion(client.getReplyCode()), "list folder");
    List<Entry> result = new ArrayList<>();
    for (FTPFile file : files) {
      String name = file.getName();
      if (name.equals(".") || name.equals("..") || name.contains("/") || !Profiles.clean(name)) continue;
      result.add(new Entry(name, file.isDirectory(), file.isSymbolicLink(), file.getSize(),
        file.getTimestamp() == null ? 0 : file.getTimestamp().getTimeInMillis()));
    }
    result.sort(Comparator.comparing(Entry::directory).reversed().thenComparing(Entry::name));
    return result;
  }
  public Entry stat(String path) throws IOException {
    if (path.equals("/")) { list(path); return new Entry("/", true, false, 0, 0); }
    int slash = path.lastIndexOf('/');
    String parent = slash == 0 ? "/" : path.substring(0, slash), name = path.substring(slash + 1);
    return list(parent).stream().filter(file -> file.name().equals(name)).findFirst().orElse(null);
  }
  public byte[] read(String path) throws IOException {
    Entry entry = stat(path);
    if (entry == null || entry.directory() || entry.link()) throw new IOException("Select a regular file. Symbolic links are not supported.");
    if (entry.size() > 32 * 1024 * 1024) throw new IOException("Files larger than 32 MiB are not supported.");
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    OutputStream limited = new FilterOutputStream(bytes) {
      private int count;
      @Override public void write(byte[] data, int offset, int length) throws IOException {
        count += length; if (count > 32 * 1024 * 1024) throw new IOException("File exceeds 32 MiB."); out.write(data, offset, length);
      }
      @Override public void write(int value) throws IOException {
        count++; if (count > 32 * 1024 * 1024) throw new IOException("File exceeds 32 MiB."); out.write(value);
      }
    };
    check(client.retrieveFile(absolute(path), limited), "download file");
    return bytes.toByteArray();
  }
  public byte[] readSearch(String path, int limit, java.util.function.BooleanSupplier cancelled) throws IOException {
    if (cancelled.getAsBoolean()) throw new InterruptedIOException("Search cancelled.");
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    OutputStream bounded = new OutputStream() {
      private int count;
      @Override public void write(byte[] data, int offset, int length) throws IOException {
        if (cancelled.getAsBoolean()) throw new InterruptedIOException("Search cancelled.");
        count += length;
        if (count > limit) throw new RemoteSearch.TooLarge();
        bytes.write(data, offset, length);
      }
      @Override public void write(int value) throws IOException { write(new byte[]{(byte)value}, 0, 1); }
    };
    try { check(client.retrieveFile(absolute(path), bounded), "download search file"); }
    catch (IOException error) {
      // A transfer aborted before its final reply must not be reused for another command.
      close();
      for (Throwable cause = error; cause != null; cause = cause.getCause()) {
        if (cause instanceof RemoteSearch.TooLarge large) throw large;
      }
      throw error;
    }
    return bytes.toByteArray();
  }
  public String write(String path, byte[] bytes, String expectedVersion) throws IOException {
    requireNonRoot(path);
    Entry before = stat(path);
    if (before != null && (before.directory() || before.link())) throw new IOException("Select a regular file.");
    if (!Objects.equals(expectedVersion, before == null ? null : before.version())) {
      throw new IOException("The file changed on the server. Keep your edits and reopen the current remote version before saving.");
    }
    String absolute = absolute(path), parent = absolute.substring(0, absolute.lastIndexOf('/') + 1);
    String temporary = parent + ".filebridge-" + UUID.randomUUID() + ".tmp";
    if (profile.atomicSave()) {
      try {
        check(client.storeFile(temporary, new ByteArrayInputStream(bytes)), "upload temporary file");
        Entry current = stat(path);
        if (!Objects.equals(expectedVersion, current == null ? null : current.version())) throw new IOException("The remote file changed during upload. Your edits were not applied.");
        check(client.rename(temporary, absolute), "replace file by rename");
      } catch (IOException error) {
        try { client.deleteFile(temporary); } catch (IOException ignored) {}
        throw error;
      }
    } else check(client.storeFile(absolute, new ByteArrayInputStream(bytes)), "upload file");
    // The transfer already succeeded. Do not report failure if a subsequent listing fails.
    try { Entry after = stat(path); return after == null ? null : after.version(); }
    catch (IOException metadataFailure) { return null; }
  }
  public void mkdir(String path) throws IOException { requireNonRoot(path); check(client.makeDirectory(absolute(path)), "create folder"); }
  public void rename(String source, String target) throws IOException {
    requireNonRoot(source); requireNonRoot(target);
    if (stat(target) != null) throw new IOException("The destination already exists.");
    check(client.rename(absolute(source), absolute(target)), "rename");
  }
  public void delete(String path) throws IOException {
    requireNonRoot(path); Entry entry = stat(path);
    if (entry == null) throw new IOException("File not found.");
    if (entry.directory()) {
      if (!list(path).isEmpty()) throw new IOException("Only empty folders can be deleted in this version.");
      check(client.removeDirectory(absolute(path)), "delete folder");
    } else check(client.deleteFile(absolute(path)), "delete file");
  }
  private void requireNonRoot(String path) throws IOException {
    if (Profiles.path("/", path).equals("/")) throw new IOException("The connection root cannot be changed.");
  }
  public boolean isConnected() { return client.isConnected(); }
  @Override public synchronized void close() {
    if (client.isConnected()) try { client.disconnect(); } catch (IOException ignored) {}
  }
}
