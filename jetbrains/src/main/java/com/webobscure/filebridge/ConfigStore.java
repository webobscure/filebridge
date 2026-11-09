package com.webobscure.filebridge;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.*;
import java.util.*;

@Service(Service.Level.APP)
@State(name = "FileBridge", storages = @Storage(value = "filebridge.xml", roamingType = RoamingType.DISABLED))
public final class ConfigStore implements PersistentStateComponent<ConfigStore.Data> {
  public static final class Binding {
    public String cachePath = "", profileId = "", remotePath = "", newline = "\n", version = "";
    public boolean bom;
  }
  public static final class Data {
    public String json = "{\n  \"remotefs.remote\": {}\n}";
    public List<Binding> files = new ArrayList<>();
  }
  private Data data = new Data();
  public static ConfigStore get() { return ApplicationManager.getApplication().getService(ConfigStore.class); }
  @Override public synchronized Data getState() { return data; }
  @Override public synchronized void loadState(Data value) { data = value; }
  public synchronized String json() { return data.json; }
  public synchronized void json(String value) { Profiles.parse(value); data.json = value; }
  public synchronized List<Profiles.Profile> profiles() { return Profiles.parse(data.json); }
  public Profiles.Profile profile(String id) {
    return profiles().stream().filter(profile -> profile.id().equals(id)).findFirst()
      .orElseThrow(() -> new IllegalStateException("This connection changed or was removed. Reopen the file from FileBridge."));
  }
  public synchronized Binding binding(String cachePath) {
    return data.files.stream().filter(file -> file.cachePath.equals(cachePath)).findFirst().orElse(null);
  }
  public synchronized void remember(Binding value) {
    data.files.removeIf(file -> file.cachePath.equals(value.cachePath)); data.files.add(value);
  }
}
