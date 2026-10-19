#!/usr/bin/env bash
# Builds the web version of FirstDay Go (including public/voice.html, the voice coach) and uploads it to the
# web hosting stack (infra/web-hosting.yaml). Picks up the coach service's URL from its stack, if deployed.
# Run from AWS CloudShell in a clone of the repo (Node 20+ and the AWS CLI are already there):
#   bash expo-go-app/infra/deploy-web.sh
set -euo pipefail

ACCOUNT=237320501162
REGION=us-east-1
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/.."

actual="$(aws sts get-caller-identity --query Account --output text)"
if [ "$actual" != "$ACCOUNT" ]; then
  echo "Refusing to deploy: signed in to AWS account $actual, expected $ACCOUNT." >&2
  exit 1
fi

out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null || true; }
bucket="$(out firstday-go-web BucketName)"
if [ -z "$bucket" ] || [ "$bucket" = "None" ]; then
  echo "The web hosting stack (firstday-go-web) isn't deployed yet: aws cloudformation deploy --template-file infra/web-hosting.yaml ..." >&2
  exit 1
fi
coach="$(out firstday-go-coach CoachUrl)"
if [ -n "$coach" ] && [ "$coach" != "None" ]; then
  export EXPO_PUBLIC_FIRSTDAY_COACH_URL="${coach%/}"
  echo "Coach service: $EXPO_PUBLIC_FIRSTDAY_COACH_URL"
else
  echo "Coach service not deployed: team trainings and 'Quiz me from other apps' stay hidden in this build."
fi

cd "$APP"
# CloudShell's home folder is only 1 GB: keep npm's cache in /tmp (and run this from a copy in /tmp if home is tight).
export npm_config_cache="${npm_config_cache:-/tmp/npm-cache}"
npm install --no-audit --no-fund
# The web build needs these (babel-preset-expo too: babel.config.js names it, and npm may leave it nested under expo);
# `expo install` picks the versions that match this Expo SDK.
npx expo install react-dom react-native-web @expo/metro-runtime babel-preset-expo
rm -rf dist
npx expo export --platform web --output-dir dist
test -f dist/voice.html
aws s3 sync dist "s3://$bucket" --region "$REGION" --only-show-errors
echo "Uploaded. https link: $(out firstday-go-web HttpsUrl)   voice coach: $(out firstday-go-web HttpsUrl)/voice.html"
