// One DynamoDB item per FirstDay account (partition key `user` = Cognito user id).
// Plain attributes: status, consent version and time, timestamps, seen conversation ids.
// The Bee sign-in itself is only ever stored sealed (see vault.mjs).
import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

const S = (v) => ({ S: String(v) });
const N = (v) => ({ N: String(Number(v) || 0) });

function toItem(user, r) {
  const item = { user: S(user), status: S(r.status), consentVersion: S(r.consentVersion), consentedAt: N(r.consentedAt), updatedAt: N(r.updatedAt), version: N(r.version) };
  if (r.sealed) item.sealed = S(r.sealed);
  if (r.connectedAt) item.connectedAt = N(r.connectedAt);
  if (r.expiresAt) item.expiresAt = N(r.expiresAt);
  if (r.seen?.length) item.seen = { L: r.seen.slice(-300).map(S) };
  if (r.inboxStarted) item.inboxStarted = { BOOL: true };
  return item;
}

function fromItem(item) {
  if (!item) return null;
  return {
    status: item.status?.S ?? "none",
    consentVersion: item.consentVersion?.S ?? "",
    consentedAt: Number(item.consentedAt?.N ?? 0),
    connectedAt: Number(item.connectedAt?.N ?? 0),
    updatedAt: Number(item.updatedAt?.N ?? 0),
    expiresAt: Number(item.expiresAt?.N ?? 0),
    version: Number(item.version?.N ?? 0),
    sealed: item.sealed?.S ?? "",
    seen: (item.seen?.L ?? []).map((x) => x.S).filter(Boolean),
    inboxStarted: item.inboxStarted?.BOOL === true,
  };
}

export function dynamoStore(table, client = new DynamoDBClient({})) {
  return {
    async get(user) {
      const r = await client.send(new GetItemCommand({ TableName: table, Key: { user: S(user) }, ConsistentRead: true }));
      const rec = fromItem(r.Item);
      // Pending sign-ins expire after 15 minutes (DynamoDB's TTL deletes them later; treat as gone now).
      if (rec && rec.expiresAt && rec.expiresAt * 1000 < Date.now()) return { ...rec, status: "none", sealed: "", expired: true };
      return rec;
    },
    /** Saves only if nobody else saved in between (optimistic lock on `version`). Returns false on a clash. */
    async put(user, rec, expectedVersion) {
      try {
        await client.send(
          new PutItemCommand({
            TableName: table,
            Item: toItem(user, { ...rec, version: expectedVersion + 1, updatedAt: Date.now() }),
            ...(expectedVersion === 0
              ? { ConditionExpression: "attribute_not_exists(#u) OR #v = :zero", ExpressionAttributeNames: { "#u": "user", "#v": "version" }, ExpressionAttributeValues: { ":zero": N(0) } }
              : { ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": N(expectedVersion) } }),
          }),
        );
        return true;
      } catch (e) {
        if (e?.name === "ConditionalCheckFailedException") return false;
        throw e;
      }
    },
    async remove(user) {
      await client.send(new DeleteItemCommand({ TableName: table, Key: { user: S(user) } }));
    },
  };
}
