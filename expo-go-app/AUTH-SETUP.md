# Accounts (Amazon Cognito)

FirstDay Go accounts use Amazon Cognito in AWS account **237320501162**, region **us-east-1**.
Accounts are optional: the app works fully without signing in.

## What's set up

| Thing | Value |
| --- | --- |
| User pool | `firstday-go-users` — `us-east-1_mZfIndG7K` |
| Tier | Lite (first 10,000 monthly active users free) |
| Sign-in | Email + password (email is the username, stored lowercase) |
| Password rules | 8+ characters, a lowercase letter, a number |
| Email confirmation | 6-digit code, required once after sign-up |
| Password reset | 6-digit code by email, then a new password |
| App client | `firstday-go-app` — `2ml0g4qv3uj1o66do3mm15r7os` (no secret) |
| Allowed flows | `USER_PASSWORD_AUTH`, `REFRESH_TOKEN_AUTH` |
| Stay signed in | Refresh token 365 days; access/ID tokens 60 minutes (refreshed automatically) |
| Token revocation | On (sign out revokes the refresh token) |
| User existence errors | Hidden (wrong email and wrong password show the same message) |
| MFA | Off |
| Deletion protection | On (the pool can't be deleted by accident) |

These IDs are built into `src/auth.ts` (they're public). To point the app at a different pool, set
`EXPO_PUBLIC_COGNITO_REGION` and `EXPO_PUBLIC_COGNITO_CLIENT_ID` in `expo-go-app/.env` (see `.env.example`)
and restart `npx expo start`.

## In the app

Settings → Account:

- **Create account**: email + password (live checklist of the rules) → 6-digit code from email → signed in.
- **Sign in**: email + password only. No code after the first confirmation.
- **Forgot password**: email → 6-digit code → new password → signed in.
- **Sign out**: revokes the refresh token on AWS.
- **Delete my account**: permanently deletes the Cognito user (required by the App Store when an app offers sign-up). Data on the phone stays.

Tokens are kept in the iPhone Keychain through `expo-secure-store`.

## Brain helper (optional)

To make `brain/server.mjs` accept only signed-in users, add to the root `.env`:

```
FIRSTDAY_GO_COGNITO_POOL_ID=us-east-1_mZfIndG7K
FIRSTDAY_GO_COGNITO_CLIENT_ID=2ml0g4qv3uj1o66do3mm15r7os
FIRSTDAY_GO_REQUIRE_ACCOUNT=1
```

It verifies the Cognito access token's signature (RS256, from the pool's public keys), issuer,
client ID, token type and expiry. The pairing code is still required.

## Before real users

Cognito currently sends email with its built-in sender, which allows only a small number of emails
per day (fine for testing). For launch, switch the user pool to Amazon SES:

1. In SES (us-east-1), verify a sending domain or address, and request production access
   (new SES accounts can only email verified addresses).
2. Cognito console → `firstday-go-users` → Messaging → Email → Amazon SES, pick the verified sender.

## Recreate from scratch (CloudShell, account 237320501162)

```bash
[ "$(aws sts get-caller-identity --query Account --output text)" = "237320501162" ] || exit 1
POOL=$(aws cognito-idp create-user-pool --region us-east-1 --pool-name firstday-go-users --user-pool-tier LITE \
  --username-attributes email --auto-verified-attributes email \
  --user-attribute-update-settings AttributesRequireVerificationBeforeUpdate=email \
  --policies 'PasswordPolicy={MinimumLength=8,RequireUppercase=false,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false,TemporaryPasswordValidityDays=7}' \
  --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
  --verification-message-template '{"DefaultEmailOption":"CONFIRM_WITH_CODE","EmailSubject":"Your FirstDay Go code","EmailMessage":"Your FirstDay Go code is {####}"}' \
  --email-configuration EmailSendingAccount=COGNITO_DEFAULT --mfa-configuration OFF --deletion-protection ACTIVE \
  --query UserPool.Id --output text)
aws cognito-idp create-user-pool-client --region us-east-1 --user-pool-id "$POOL" --client-name firstday-go-app \
  --no-generate-secret --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --prevent-user-existence-errors ENABLED --enable-token-revocation \
  --access-token-validity 60 --id-token-validity 60 --refresh-token-validity 365 \
  --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=days \
  --query UserPoolClient.ClientId --output text
```

If you change the password rules, update `PASSWORD_RULES` in `src/auth.ts` to match.
