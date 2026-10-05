#!/usr/bin/env bash
# Deploys the FirstDay Go AI endpoint (infra/template.yaml) into AWS account 237320501162, us-east-1.
# Run from AWS CloudShell (or anywhere the AWS CLI is signed in to that account):
#   bash expo-go-app/infra/deploy.sh
set -euo pipefail

ACCOUNT=237320501162
REGION=us-east-1
STACK=firstday-go-ai
HERE="$(cd "$(dirname "$0")" && pwd)"

actual="$(aws sts get-caller-identity --query Account --output text)"
if [ "$actual" != "$ACCOUNT" ]; then
  echo "Refusing to deploy: signed in to AWS account $actual, expected $ACCOUNT." >&2
  exit 1
fi

# Only cap concurrency when the account has room (new accounts can have a limit of 10).
limit="$(aws lambda get-account-settings --region "$REGION" --query AccountLimit.ConcurrentExecutions --output text)"
cap=""
if [ "$limit" -ge 110 ]; then cap=5; fi

aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file "$HERE/template.yaml" --capabilities CAPABILITY_IAM \
  --parameter-overrides "ReservedConcurrency=$cap" --no-fail-on-empty-changeset

build="$(mktemp -d)"
cp "$HERE/lambda/index.mjs" "$HERE/../brain/ai.mjs" "$HERE/../brain/cognito.mjs" "$build/"
(cd "$build" && zip -q function.zip index.mjs ai.mjs cognito.mjs)
aws lambda update-function-code --region "$REGION" --function-name firstday-go-ai \
  --zip-file "fileb://$build/function.zip" --query LastUpdateStatus --output text
aws lambda wait function-updated --region "$REGION" --function-name firstday-go-ai

# Function URLs created after October 2025 also need lambda:InvokeFunction for public access.
aws lambda add-permission --region "$REGION" --function-name firstday-go-ai \
  --statement-id public-url-invoke --action lambda:InvokeFunction --principal "*" \
  --invoked-via-function-url >/dev/null 2>&1 || true

url="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)"
echo "AI endpoint: $url"
echo "Health:      $(curl -s "${url}health")"
