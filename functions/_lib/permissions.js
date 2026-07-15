import { collectionPolicy, isAdmin } from "./auth.js";

function permissionsOf(row) {
  try {
    const value = JSON.parse(row.permissions_json || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function matchesRole(permission, action, user) {
  const prefix = `${action}("`;
  if (!permission.startsWith(prefix) || !permission.endsWith('")')) return false;
  const role = permission.slice(prefix.length, -2);
  if (role === "any") return true;
  if (role === "guests") return !user;
  if (role === "users") return Boolean(user?.$id);
  if (!user?.$id) return false;
  if (role === `user:${user.$id}`) return true;
  if (Array.isArray(user.labels) && role.startsWith("label:")) {
    return user.labels.includes(role.slice(6));
  }
  return false;
}

export function canRead(row, user, env) {
  if (isAdmin(user, env)) return true;
  if (collectionPolicy(env, "D1_PUBLIC_READ_COLLECTIONS", row.collection_id)) return true;
  if (collectionPolicy(env, "D1_AUTHENTICATED_READ_COLLECTIONS", row.collection_id) && user?.$id) return true;
  const permissions = permissionsOf(row);
  if (permissions.some((permission) => matchesRole(permission, "read", user) || matchesRole(permission, "write", user))) {
    return true;
  }
  if (permissions.length === 0 && String(env.D1_EMPTY_PERMISSIONS_PUBLIC || "false").toLowerCase() === "true") {
    return true;
  }
  return Boolean(user?.$id && row.owner_id === user.$id);
}

export function canWrite(row, user, env, action = "update") {
  if (!user?.$id) return false;
  if (isAdmin(user, env)) return true;
  if (row.owner_id && row.owner_id === user.$id) return true;
  const permissions = permissionsOf(row);
  return permissions.some((permission) => matchesRole(permission, action, user) || matchesRole(permission, "write", user));
}

export function defaultPermissions(collectionId, user, env) {
  if (!user?.$id) {
    return collectionPolicy(env, "D1_PUBLIC_READ_COLLECTIONS", collectionId) ? ['read("any")'] : [];
  }
  const output = [
    `update("user:${user.$id}")`,
    `delete("user:${user.$id}")`,
    `write("user:${user.$id}")`,
  ];
  output.push(
    collectionPolicy(env, "D1_PUBLIC_READ_COLLECTIONS", collectionId)
      ? 'read("any")'
      : `read("user:${user.$id}")`,
  );
  return output;
}
