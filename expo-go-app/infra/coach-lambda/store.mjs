// The coach service's DynamoDB table: one on-demand table, partition key `pk`, sort key `sk`.
// Each item keeps its data as one JSON string `d` and a version number `v` for safe concurrent updates.
//   TEAM#<code>  / META          a shared training (trainer, steps, version, member count)
//   USER#<id>    / TEAM#<code>   that you joined or shared it (role)
//   USER#<id>    / COACH         your confirmed steps for the MCP server (only when you turned it on)
//   USER#<id>    / TOKEN#<id>    one key for another app (only its hash is kept)
//   TOKEN#<hash> / META          key lookup for the MCP server
import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";

export function dynamoStore(table, client = new DynamoDBClient({})) {
  const S = (v) => ({ S: String(v) });
  const parse = (item) => (item ? { ...JSON.parse(item.d.S), _v: Number(item.v?.N ?? 0) } : null);
  return {
    async get(pk, sk) {
      const r = await client.send(new GetItemCommand({ TableName: table, Key: { pk: S(pk), sk: S(sk) }, ConsistentRead: true }));
      return parse(r.Item);
    },
    /** `expectV`: undefined = always write; 0 = only if new; n = only if nobody wrote since version n. */
    async put(pk, sk, data, expectV) {
      const { _v, sk: _sk, ...clean } = data;
      const next = (expectV ?? 0) + 1;
      try {
        await client.send(
          new PutItemCommand({
            TableName: table,
            Item: { pk: S(pk), sk: S(sk), v: { N: String(expectV === undefined ? 1 : next) }, d: S(JSON.stringify(clean)) },
            ...(expectV === undefined
              ? {}
              : expectV === 0
                ? { ConditionExpression: "attribute_not_exists(pk)" }
                : { ConditionExpression: "v = :v", ExpressionAttributeValues: { ":v": { N: String(expectV) } } }),
          }),
        );
        return true;
      } catch (e) {
        if (e?.name === "ConditionalCheckFailedException") return false;
        throw e;
      }
    },
    async del(pk, sk) {
      await client.send(new DeleteItemCommand({ TableName: table, Key: { pk: S(pk), sk: S(sk) } }));
    },
    async query(pk, prefix) {
      const r = await client.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": S(pk), ":p": S(prefix) },
          ConsistentRead: true,
          Limit: 100,
        }),
      );
      return (r.Items ?? []).map((it) => ({ ...parse(it), sk: it.sk.S }));
    },
  };
}
