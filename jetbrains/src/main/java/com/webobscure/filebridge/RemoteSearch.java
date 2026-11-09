package com.webobscure.filebridge;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.function.*;
import java.util.regex.Pattern;

/** Searches remote bytes without populating the editor cache or modifying server files. */
public final class RemoteSearch {
  private RemoteSearch() {}
  public record Options(String query, boolean matchCase, List<String> exclude, int maxBytes, int maxResults) {
    public Options {
      if (query == null || query.isEmpty() || query.length() > 1024 || query.matches("(?s).*[\\r\\n\\x00].*") ||
          maxBytes < 1 || maxBytes > 128 * 1024 * 1024 || maxResults < 1 || maxResults > 50000) {
        throw new IllegalArgumentException("Enter a single line of search text (1–1024 characters) and valid limits.");
      }
      exclude = List.copyOf(exclude);
      for (String rule : exclude) if (rule.isBlank() || rule.replace("/", "").isEmpty() ||
          rule.matches("(?s).*[\\r\\n\\x00\\\\*?].*") || Arrays.asList(rule.split("/")).contains("..")) {
        throw new IllegalArgumentException("Exclusions must be exact names or relative paths, without wildcards or '..'.");
      }
    }
  }
  public record Match(String path, int line, int column, int length, String preview) {
    @Override public String toString() { return (line + 1) + ":" + (column + 1) + "  " + preview; }
  }
  public static final class Summary {
    public int scanned, matches, excluded, binary, large, links, errors;
    public boolean cancelled, limited;
    public final List<String> issues = new ArrayList<>();
    @Override public String toString() {
      return (cancelled ? "Cancelled" : limited ? "Result limit reached" : errors > 0 ? "Finished with errors" : "Finished") +
        ": " + matches + " matches · " + scanned + " files searched · " + excluded + " excluded · " + binary +
        " binary/non-UTF-8 · " + large + " too large · " + links + " links · " + errors + " errors";
    }
  }
  public static final class TooLarge extends IOException {}
  public interface Source {
    List<FtpTransport.Entry> list(String path) throws IOException;
    byte[] read(String path, int limit) throws IOException;
  }
  public static Source source(FtpTransport ftp, BooleanSupplier cancelled) {
    return new Source() {
      public List<FtpTransport.Entry> list(String path) throws IOException { return ftp.list(path); }
      public byte[] read(String path, int limit) throws IOException { return ftp.readSearch(path, limit, cancelled); }
    };
  }
  private static boolean excluded(String relative, List<String> rules) {
    for (String rule : rules) {
      String clean = rule.replaceAll("^/+|/+$", "");
      if (clean.contains("/") ? relative.equals(clean) || relative.startsWith(clean + "/") : Arrays.asList(relative.split("/")).contains(clean)) return true;
    }
    return false;
  }
  private static void issue(Summary result, String path) {
    result.errors++;
    if (result.issues.size() < 100) result.issues.add("Could not read " + path + ". Check permissions and connection.");
  }
  public static Summary search(Source source, String root, Options options, BooleanSupplier cancelled,
                               Consumer<Match> onMatch, BiConsumer<Summary, String> progress) {
    Profiles.path("/", root);
    Summary result = new Summary();
    Deque<String> folders = new ArrayDeque<>(); folders.push(root);
    String base = root.replaceAll("/$", "");
    Pattern query = Pattern.compile(Pattern.quote(options.query()), options.matchCase() ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    while (!folders.isEmpty() && !cancelled.getAsBoolean() && !result.limited) {
      String folder = folders.pop();
      List<FtpTransport.Entry> entries;
      try { entries = source.list(folder); }
      catch (IOException error) { if (!cancelled.getAsBoolean()) issue(result, folder); continue; }
      for (FtpTransport.Entry entry : entries) {
        if (cancelled.getAsBoolean() || result.limited) break;
        if (!Profiles.clean(entry.name()) || List.of(".", "..").contains(entry.name()) || entry.name().contains("/") || entry.name().contains("\\")) continue;
        String path = (folder.equals("/") ? "" : folder) + "/" + entry.name();
        if (excluded(path.substring(base.length()).replaceFirst("^/", ""), options.exclude())) { result.excluded++; continue; }
        if (entry.link()) { result.links++; continue; }
        if (entry.directory()) { folders.push(path); continue; }
        if (entry.size() > options.maxBytes()) { result.large++; continue; }
        progress.accept(result, path);
        byte[] bytes;
        try { bytes = source.read(path, options.maxBytes()); }
        catch (TooLarge error) { result.large++; continue; }
        catch (IOException error) { if (!cancelled.getAsBoolean()) issue(result, path); continue; }
        if (cancelled.getAsBoolean()) break;
        if (bytes.length > options.maxBytes()) { result.large++; continue; }
        String text;
        try {
          for (byte b : bytes) if (b == 0) throw new CharacterCodingException();
          text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
          if (text.startsWith("\ufeff")) text = text.substring(1);
        } catch (CharacterCodingException binary) { result.binary++; continue; }
        result.scanned++;
        String[] lines = text.split("\\r\\n|\\n|\\r", -1);
        for (int line = 0; line < lines.length && !result.limited && !cancelled.getAsBoolean(); line++) {
          var matcher = query.matcher(lines[line]);
          while (!cancelled.getAsBoolean() && matcher.find()) {
            int start = Math.max(0, matcher.start() - 60);
            int end = Math.min(lines[line].length(), Math.max(start + 180, matcher.start() + Math.min(matcher.end() - matcher.start(), 120)));
            onMatch.accept(new Match(path, line, matcher.start(), matcher.end() - matcher.start(), (start > 0 ? "…" : "") + lines[line].substring(start, end)));
            if (++result.matches >= options.maxResults()) { result.limited = true; break; }
          }
        }
      }
    }
    result.cancelled = cancelled.getAsBoolean();
    return result;
  }
}
