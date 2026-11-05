# Migrating from `dsh-session-groups` to `dsh-session-grove`

`0.4.0-beta.1` is a deliberate identity reset. The plugin does **not** read or
copy data from the old `dsh-session-groups` identity.

This is intentional: the old package name is shared with unrelated community
plugins, so automatically importing `dsh-session-groups.json` could load another
plugin's data into this one. The old file is left untouched.

## Before installing

1. Quit every DSH Web/Desktop window.
2. Back up the old record and its sidecars:

   ```text
   <dshHome>/storages/dsh-session-groups.json
   <dshHome>/storages/dsh-session-groups.json.bak
   ```

3. Remove the old plugin from the profile, or create a fresh profile for the
   new package. Do not run both package names in one profile.
4. Install `dsh-session-grove` and restart the client.

## Optional manual data migration

Only do this when you are certain the old file belongs to your own old plugin,
not to another same-named community plugin, and after the old plugin is
uninstalled:

```text
copy <dshHome>/storages/dsh-session-groups.json
  → <dshHome>/storages/dsh-session-grove.json
```

Keep the original file and backup until the new install has been checked.
The new plugin writes its own `dsh-session-grove.json.bak` from that point on.

Browser preferences use new localStorage keys and are **not** copied
automatically:

```text
dsh-session-grove.view.v1
dsh-session-grove.archive.v1
dsh-session-grove.collapsed.v1
dsh-session-grove.onboarded.v1
dsh-session-grove.width.v1
dsh-session-grove.dialog.geometry.v9
```

The old `dsh-session-groups.*` keys are ignored and can be removed manually
after migration. There is no code path that reads or deletes them.

## New runtime paths

```text
routes:       /dsh-session-grove/*
record:       <dshHome>/storages/dsh-session-grove.json
control:      <dshHome>/storages/dsh-session-grove.control-token
diagnostics:  <dshHome>/storages/dsh-session-grove.diagnostics.ndjson
debug:        <dshHome>/storages/dsh-session-grove.debug.ndjson
skill:        <dshHome>/skills/session-grove-control/SKILL.md
```

The old files can be archived or deleted manually after the acceptance check.
