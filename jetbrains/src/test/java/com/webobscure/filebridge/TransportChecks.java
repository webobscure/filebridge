package com.webobscure.filebridge;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class TransportChecks {
  static int passed;
  static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
  static void fails(Checked work) throws Exception { try { work.run(); } catch (Exception expected) { return; } throw new AssertionError("Expected failure"); }
  @FunctionalInterface interface Checked { void run() throws Exception; }
  static void test(String name, Checked work) throws Exception { work.run(); passed++; System.out.println("PASS " + name); }
  static Profiles.Profile profile(JsonObject fixture, String scheme, String user, int port, boolean atomic) {
    return Profiles.parse("{\"test\":{\"scheme\":\"" + scheme + "\",\"host\":\"127.0.0.1\",\"port\":" + port +
      ",\"username\":\"" + user + "\",\"rootPath\":\"/public_html\",\"atomicSave\":" + atomic + ",\"connectTimeout\":3000}}").getFirst();
  }
  public static void main(String[] args) throws Exception {
    JsonObject f = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject(); run(f);
  }
  static void run(JsonObject f) throws Exception {
    Path root = Path.of(f.get("root").getAsString()), disk = root.resolve("public_html");
    int port = f.get("port").getAsInt();
    Profiles.Profile profile = profile(f, "ftp", "tester", port, true);
    test("legacy JSON, default options, stable route IDs, and path validation", () -> {
      Profiles.Profile p = Profiles.parse("{\"remotefs.remote\":{\"a.b\":{\"host\":\"localhost\",\"username\":\"user\"}}}").getFirst();
      check(p.port() == 21 && p.rootPath().equals("/") && p.atomicSave(), "Defaults");
      check(!p.toString().contains("password"), "Safe display");
      fails(() -> Profiles.path("/root", "/../etc"));
      fails(() -> Profiles.parse("{\"bad\":{\"host\":\"host\",\"username\":\"user\",\"port\":0}}"));
    });
    test("list, read, atomic save, and server bytes", () -> {
      try (FtpTransport ftp = new FtpTransport(profile, "test-password")) {
        check(ftp.list("/").stream().anyMatch(e -> e.name().equals("hello.txt")), "Listing");
        check(new String(ftp.read("/hello.txt"), StandardCharsets.UTF_8).equals("hello"), "Download");
        ftp.write("/hello.txt", "updated".getBytes(StandardCharsets.UTF_8), ftp.stat("/hello.txt").version());
        check(Files.readString(disk.resolve("hello.txt")).equals("updated"), "Upload bytes");
      }
    });
    test("unicode, spaces, percent and hash in filenames", () -> {
      try (FtpTransport ftp = new FtpTransport(profile, "test-password")) {
        ftp.write("/тест 100% #.txt", "Привет".getBytes(StandardCharsets.UTF_8), null);
        check(new String(ftp.read("/тест 100% #.txt"), StandardCharsets.UTF_8).equals("Привет"), "Unicode");
      }
    });
    test("create folder and file, rename, nonempty folder guard, delete", () -> {
      try (FtpTransport ftp = new FtpTransport(profile, "test-password")) {
        ftp.mkdir("/folder"); ftp.write("/folder/a.txt", new byte[0], null);
        fails(() -> ftp.delete("/folder")); ftp.rename("/folder/a.txt", "/folder/b.txt");
        ftp.delete("/folder/b.txt"); ftp.delete("/folder");
        fails(() -> ftp.delete("/"));
      }
    });
    test("external changes block save", () -> {
      try (FtpTransport ftp = new FtpTransport(profile, "test-password")) {
        String version = ftp.stat("/hello.txt").version();
        Files.writeString(disk.resolve("hello.txt"), "changed by somebody else");
        fails(() -> ftp.write("/hello.txt", "mine".getBytes(), version));
        check(Files.readString(disk.resolve("hello.txt")).equals("changed by somebody else"), "No overwrite");
      }
    });
    test("failed upload and rename keep original and clean temporary files", () -> {
      for (String marker : List.of("reject-upload", "reject-rename")) {
        try (FtpTransport ftp = new FtpTransport(profile, "test-password")) {
          String version = ftp.stat("/hello.txt").version(); Files.writeString(root.resolve(marker), "1");
          try { fails(() -> ftp.write("/hello.txt", "replacement".getBytes(), version)); }
          finally { Files.deleteIfExists(root.resolve(marker)); }
          check(Files.readString(disk.resolve("hello.txt")).equals("changed by somebody else"), "Original survives");
          try (var files = Files.list(disk)) { check(files.noneMatch(p -> p.getFileName().toString().startsWith(".filebridge-")), "Temp cleanup"); }
        }
      }
    });
    test("direct save and read-only permissions", () -> {
      try (FtpTransport ftp = new FtpTransport(profile(f,"ftp","tester",port,false),"test-password")) {
        ftp.write("/direct.txt", "direct".getBytes(), null);
      }
      try (FtpTransport ftp = new FtpTransport(profile(f,"ftp","reader",port,true),"test-password")) {
        check(ftp.read("/direct.txt").length == 6, "Read-only reads"); fails(() -> ftp.write("/direct.txt", new byte[0], ftp.stat("/direct.txt").version()));
      }
    });
    test("trusted FTPS transfers and untrusted certificate rejection", () -> {
      try (FtpTransport ftp = new FtpTransport(profile(f,"ftps","tester",f.get("tlsPort").getAsInt(),true),"test-password")) {
        ftp.write("/secure.txt", "TLS".getBytes(), null); check(ftp.read("/secure.txt").length == 3, "FTPS");
      }
      fails(() -> { try (var ignored = new FtpTransport(profile(f,"ftps","tester",f.get("badTlsPort").getAsInt(),true),"test-password")) {} });
      fails(() -> { try (var ignored = new FtpTransport(profile,"wrong-password")) {} });
    });
    test("recursive FTP search reads unopened files, excludes paths, and reports skipped files", () -> {
      Files.createDirectories(disk.resolve("search/nested")); Files.createDirectories(disk.resolve("search/excluded"));
      Files.createDirectories(disk.resolve("search/.hidden"));
      Files.writeString(disk.resolve("search/.hidden/secret.php"), "SearchToken");
      Files.writeString(disk.resolve("search/a.php"), "\ufeffintro\r\n😀 SearchToken SEARCHTOKEN\r\n");
      Files.writeString(disk.resolve("search/nested/тест.php"), "SearchToken");
      Files.writeString(disk.resolve("search/excluded/skip.php"), "SearchToken");
      Files.write(disk.resolve("search/binary"), new byte[]{0, 1}); Files.write(disk.resolve("search/invalid"), new byte[]{(byte)255});
      Files.writeString(disk.resolve("search/large"), "x".repeat(2048));
      Files.writeString(disk.resolve("outside-search.php"), "SearchToken");
      Files.createSymbolicLink(disk.resolve("search/link"), disk.resolve("search/nested"));
      try (FtpTransport ftp = new FtpTransport(profile, "test-password")) {
        List<RemoteSearch.Match> hits = new ArrayList<>();
        var options = new RemoteSearch.Options("searchtoken", false, List.of("excluded"), 1024, 100);
        var summary = RemoteSearch.search(RemoteSearch.source(ftp, () -> false), "/search", options, () -> false, hits::add, (s, p) -> {});
        check(summary.matches == 4 && summary.scanned == 3 && summary.excluded == 1, "Recursive matches, hidden files and exclusions");
        check(summary.binary == 2 && summary.large == 1 && summary.links == 1 && summary.errors == 0, "Skipped counts");
        check(hits.getFirst().line() == 1 && hits.getFirst().column() == 3, "CRLF, BOM, UTF-16 positions");
        var sensitive = RemoteSearch.search(RemoteSearch.source(ftp, () -> false), "/search", new RemoteSearch.Options("SearchToken", true, List.of("excluded"), 1024, 100), () -> false, hit -> {}, (s,p) -> {});
        check(sensitive.matches == 3, "Match case");
      }
    });
    test("search result limit, cancellation, denied folders and byte limit", () -> {
      try (FtpTransport ftp = new FtpTransport(profile, "test-password")) {
        var options = new RemoteSearch.Options("SearchToken", false, List.of("excluded"), 1024, 1);
        var limited = RemoteSearch.search(RemoteSearch.source(ftp, () -> false), "/search", options, () -> false, hit -> {}, (s,p) -> {});
        check(limited.limited && limited.matches == 1, "Limit");
        var cancelled = new java.util.concurrent.atomic.AtomicBoolean();
        var partial = RemoteSearch.search(RemoteSearch.source(ftp, cancelled::get), "/search", new RemoteSearch.Options("SearchToken", false, List.of(), 1024, 100), cancelled::get, hit -> cancelled.set(true), (s,p) -> {});
        check(partial.cancelled && partial.matches == 1, "Partial results on cancellation");
        var denied = RemoteSearch.search(RemoteSearch.source(ftp, () -> false), "/missing-folder", options, () -> false, hit -> {}, (s,p) -> {});
        check(denied.errors == 1 && !denied.issues.isEmpty(), "Unreadable folder is visible");
        try { ftp.readSearch("/search/large", 10, () -> false); throw new AssertionError("Expected byte limit"); }
        catch (RemoteSearch.TooLarge expected) { check(!ftp.isConnected(), "Aborted transfer closes connection"); }
      }
      fails(() -> new RemoteSearch.Options("", false, List.of(), 1024, 1));
      fails(() -> new RemoteSearch.Options("x", false, List.of("*.log"), 1024, 1));
    });
    test("FTPS remote search uses the same recursive engine", () -> {
      try (FtpTransport ftp = new FtpTransport(profile(f,"ftps","tester",f.get("tlsPort").getAsInt(),true),"test-password")) {
        var summary = RemoteSearch.search(RemoteSearch.source(ftp, () -> false), "/search/nested", new RemoteSearch.Options("SearchToken", true, List.of(), 1024, 100), () -> false, hit -> {}, (s,p) -> {});
        check(summary.matches == 1 && summary.errors == 0, "FTPS search");
      }
    });
    System.out.println("Transport checks passed: " + passed);
  }
}
