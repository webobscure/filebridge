package com.webobscure.filebridge;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

public final class Profiles {
  private Profiles() {}
  public record Profile(String id, String name, String scheme, String host, int port,
                        String username, String rootPath, int timeout, boolean atomicSave, String password) {
    @Override public String toString() { return name; }
  }
  public static List<Profile> parse(String json) {
    try {
      JsonObject root = JsonParser.parseString(json).getAsJsonObject();
      JsonObject remotes = root.has("remotefs.remote") ? root.getAsJsonObject("remotefs.remote") : root;
      List<Profile> result = new ArrayList<>();
      for (var item : remotes.entrySet()) {
        JsonObject config = item.getValue().getAsJsonObject();
        String scheme = text(config, "scheme", "ftp"), host = text(config, "host", "");
        String username = text(config, "username", ""), folder = text(config, "rootPath", "/");
        String name = text(config, "name", item.getKey());
        String password = config.has("password") ? config.get("password").getAsString() : null;
        int port = config.has("port") ? config.get("port").getAsInt() : (scheme.equals("ftps-implicit") ? 990 : 21);
        int timeout = config.has("connectTimeout") ? config.get("connectTimeout").getAsInt() : 30000;
        boolean atomic = !config.has("atomicSave") || config.get("atomicSave").getAsBoolean();
        if (!List.of("ftp", "ftps", "ftps-implicit").contains(scheme) || !clean(host) || host.matches(".*[\\s/@].*") ||
            !clean(username) || !clean(name) || port < 1 || port > 65535 || timeout < 1000 ||
            (password != null && password.matches("(?s).*[\\r\\n\\x00].*"))) {
          throw new IllegalArgumentException();
        }
        path(folder, "/");
        String id = hash(item.getKey() + "\n" + scheme + "\n" + host + "\n" + port + "\n" + username + "\n" + folder);
        result.add(new Profile(id, name, scheme, host, port, username, folder, timeout, atomic, password));
      }
      return List.copyOf(result);
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("Invalid connection JSON. Check host, username, scheme, port, rootPath, and field types.");
    }
  }
  private static String text(JsonObject object, String field, String fallback) {
    if (!object.has(field)) return fallback;
    JsonPrimitive value = object.getAsJsonPrimitive(field);
    if (!value.isString()) throw new IllegalArgumentException();
    return value.getAsString();
  }
  public static boolean clean(String value) { return value != null && !value.isBlank() && !value.matches("(?s).*[\\r\\n\\x00].*"); }
  public static String path(String root, String path) {
    for (String value : List.of(root, path)) {
      if (!value.startsWith("/") || value.matches("(?s).*[\\r\\n\\x00\\\\].*") || Arrays.asList(value.split("/")).contains("..")) {
        throw new IllegalArgumentException("Use an absolute remote path without '..', backslashes, or control characters.");
      }
    }
    return (root + "/" + path).replaceAll("/+", "/").replaceAll("(?<!^)/$", "");
  }
  public static String hash(String value) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception impossible) { throw new IllegalStateException(impossible); }
  }
}
