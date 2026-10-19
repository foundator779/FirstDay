#!/usr/bin/env bash
# Deploys the FirstDay coach service (infra/coach.yaml): team trainings and the coach MCP server.
# Run from AWS CloudShell (or anywhere the AWS CLI is signed in to the target account):
#   bash expo-go-app/infra/deploy-coach.sh
set -euo pipefail

ACCOUNT=237320501162
REGION=us-east-1
STACK=firstday-go-coach
HERE="$(cd "$(dirname "$0")" && pwd)"

actual="$(aws sts get-caller-identity --query Account --output text)"
if [ "$actual" != "$ACCOUNT" ]; then
  echo "Refusing to deploy: signed in to AWS account $actual, expected $ACCOUNT." >&2
  exit 1
fi

aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file "$HERE/coach.yaml" --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset

# Package: the service, the shared coach logic and the token check (no npm install: the Lambda
# Node.js runtime already includes the AWS SDK for DynamoDB).
build="$(mktemp -d)"
cp "$HERE/coach-lambda/"{index,app,mcp,store}.mjs "$HERE/../brain/coach.mjs" "$HERE/../brain/cognito.mjs" "$build/"
(cd "$build" && echo '{"type":"module"}' > package.json && zip -q function.zip index.mjs app.mjs mcp.mjs store.mjs coach.mjs cognito.mjs package.json)
aws lambda update-function-code --region "$REGION" --function-name firstday-go-coach \
  --zip-file "fileb://$build/function.zip" --query LastUpdateStatus --output text
aws lambda wait function-updated --region "$REGION" --function-name firstday-go-coach

# Function URLs created after October 2025 also need lambda:InvokeFunction for public access.
aws lambda add-permission --region "$REGION" --function-name firstday-go-coach \
  --statement-id public-url-invoke --action lambda:InvokeFunction --principal "*" \
  --invoked-via-function-url >/dev/null 2>&1 || true

url="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='CoachUrl'].OutputValue" --output text)"
echo "Coach service: $url"
echo "MCP server:    ${url}mcp"
echo "Health:        $(curl -s "${url}health")"
echo "Next: set DEFAULT_URL in expo-go-app/src/coachCloud.ts (or EXPO_PUBLIC_FIRSTDAY_COACH_URL) to ${url%/}"
