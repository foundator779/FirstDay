#!/usr/bin/env bash
# Deploys the FirstDay Bee service (infra/bee-connect.yaml) into AWS account 237320501162, us-east-1.
# Run from AWS CloudShell, with the email of the FirstDay account that may connect Bee:
#   ALLOWED_EMAIL=you@example.com bash expo-go-app/infra/deploy-bee.sh
# Several accounts: ALLOWED_EMAIL="a@x.com,b@y.com". Everyone (only with Bee's OK): OPEN_TO_EVERYONE=true.
set -euo pipefail

ACCOUNT=237320501162
REGION=us-east-1
STACK=firstday-go-bee
HERE="$(cd "$(dirname "$0")" && pwd)"

actual="$(aws sts get-caller-identity --query Account --output text)"
if [ "$actual" != "$ACCOUNT" ]; then
  echo "Refusing to deploy: signed in to AWS account $actual, expected $ACCOUNT." >&2
  exit 1
fi

emails="$(echo "${ALLOWED_EMAIL:-}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
open="${OPEN_TO_EVERYONE:-false}"
if [ -z "$emails" ] && [ "$open" != "true" ]; then
  echo "Set ALLOWED_EMAIL to the FirstDay account email that may connect Bee." >&2
  exit 1
fi

aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file "$HERE/bee-connect.yaml" --capabilities CAPABILITY_IAM \
  --parameter-overrides "AllowedEmails=$emails" "OpenToEveryone=$open" --no-fail-on-empty-changeset

# Package: the service, the brain's Bee code and token check, and Bee's official CLI.
# The npm package ships ready-made programs for every system (about 420 MB); Lambda only needs Linux x64.
build="$(mktemp -d)"
cp "$HERE/bee-lambda/"{index,app,vault,store}.mjs "$HERE/../brain/bee.mjs" "$HERE/../brain/cognito.mjs" "$build/"
(
  cd "$build"
  echo '{"name":"firstday-go-bee","private":true,"type":"module"}' > package.json
  mkdir cli && (cd cli && echo '{"private":true}' > package.json && npm install --omit=dev --no-audit --no-fund "@beeai/cli@${BEE_CLI_VERSION:-latest}" >/dev/null)
  bin="cli/node_modules/@beeai/cli/dist/platforms/linux-x64/bee"
  test -x "$bin" || { echo "The Bee CLI didn't install ($bin missing)." >&2; exit 1; }
  mkdir bee-cli && cp "$bin" bee-cli/bee && chmod 755 bee-cli/bee
  echo "Bee CLI: $(HOME="$(mktemp -d)" bee-cli/bee --version 2>&1 | head -1)"
  zip -qr function.zip index.mjs app.mjs vault.mjs store.mjs bee.mjs cognito.mjs package.json bee-cli
)
size=$(stat -c %s "$build/function.zip")
if [ "$size" -gt 50000000 ]; then
  echo "Package is $((size / 1000000)) MB; direct upload allows 50 MB. Upload through S3 instead." >&2
  exit 1
fi
aws lambda update-function-code --region "$REGION" --function-name firstday-go-bee \
  --zip-file "fileb://$build/function.zip" --query LastUpdateStatus --output text
aws lambda wait function-updated --region "$REGION" --function-name firstday-go-bee

# Function URLs created after October 2025 also need lambda:InvokeFunction for public access.
aws lambda add-permission --region "$REGION" --function-name firstday-go-bee \
  --statement-id public-url-invoke --action lambda:InvokeFunction --principal "*" \
  --invoked-via-function-url >/dev/null 2>&1 || true

url="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text)"
echo "Bee service: $url"
echo "Health:      $(curl -s "${url}health")"
echo "Allowed accounts: ${emails:-everyone}"
