#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AWS_PROFILE_NAME="${AWS_PROFILE:-medplum}"
AWS_REGION_NAME="${AWS_REGION:-us-east-1}"
EXPECTED_ACCOUNT_ID="229015218172"
STACK_NAME="${STACK_NAME:-olive-agents-poc-staging}"
ENABLE_POLLER="${ENABLE_POLLER:-false}"
DEPLOY_DRY_RUN="${DRY_RUN:-true}"
HARNESS_MODEL_ID="${HARNESS_MODEL_ID:-amazon.nova-pro-v1:0}"

if [[ "${ENABLE_POLLER}" != "true" && "${ENABLE_POLLER}" != "false" ]]; then
  echo "ENABLE_POLLER must be true or false" >&2
  exit 1
fi
if [[ "${DEPLOY_DRY_RUN}" != "true" && "${DEPLOY_DRY_RUN}" != "false" ]]; then
  echo "DRY_RUN must be true or false" >&2
  exit 1
fi

cd "${PROJECT_DIR}"
set -a
source ./.env
set +a

: "${STAGING_OLIVE_CONVERSATIONS_API_KEY:?Missing STAGING_OLIVE_CONVERSATIONS_API_KEY in .env}"
: "${CONNECT_API_KEY_STAGING_MESSAGE_TEST:?Missing CONNECT_API_KEY_STAGING_MESSAGE_TEST in .env}"

ACCOUNT_ID="$(aws sts get-caller-identity \
  --profile "${AWS_PROFILE_NAME}" \
  --region "${AWS_REGION_NAME}" \
  --query Account \
  --output text)"
if [[ "${ACCOUNT_ID}" != "${EXPECTED_ACCOUNT_ID}" ]]; then
  echo "Refusing to deploy to AWS account ${ACCOUNT_ID}; expected ${EXPECTED_ACCOUNT_ID}" >&2
  exit 1
fi

npm run check
npm test
npm run build

mkdir -p .local
rm -f .local/lambda.zip
(cd dist/lambda && zip -q -r ../../.local/lambda.zip index.js index.js.map)

ARTIFACT_BUCKET="olive-agents-poc-artifacts-${ACCOUNT_ID}-${AWS_REGION_NAME}"
if ! aws s3api head-bucket --profile "${AWS_PROFILE_NAME}" --bucket "${ARTIFACT_BUCKET}" >/dev/null 2>&1; then
  if [[ "${AWS_REGION_NAME}" == "us-east-1" ]]; then
    aws s3api create-bucket \
      --profile "${AWS_PROFILE_NAME}" \
      --region "${AWS_REGION_NAME}" \
      --bucket "${ARTIFACT_BUCKET}" >/dev/null
  else
    aws s3api create-bucket \
      --profile "${AWS_PROFILE_NAME}" \
      --region "${AWS_REGION_NAME}" \
      --bucket "${ARTIFACT_BUCKET}" \
      --create-bucket-configuration "LocationConstraint=${AWS_REGION_NAME}" >/dev/null
  fi
  aws s3api put-public-access-block \
    --profile "${AWS_PROFILE_NAME}" \
    --region "${AWS_REGION_NAME}" \
    --bucket "${ARTIFACT_BUCKET}" \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi

CODE_DIGEST="$(shasum -a 256 .local/lambda.zip | awk '{print $1}')"
CODE_KEY="lambda/${CODE_DIGEST}.zip"
aws s3 cp .local/lambda.zip "s3://${ARTIFACT_BUCKET}/${CODE_KEY}" \
  --profile "${AWS_PROFILE_NAME}" \
  --region "${AWS_REGION_NAME}" \
  --only-show-errors

deploy_stack() {
  local poller_enabled="$1"
  aws cloudformation deploy \
    --profile "${AWS_PROFILE_NAME}" \
    --region "${AWS_REGION_NAME}" \
    --stack-name "${STACK_NAME}" \
    --template-file infra/template.yaml \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides \
      "LambdaCodeBucket=${ARTIFACT_BUCKET}" \
      "LambdaCodeKey=${CODE_KEY}" \
      "PollerEnabled=${poller_enabled}" \
      "DryRun=${DEPLOY_DRY_RUN}" \
      "HarnessModelId=${HARNESS_MODEL_ID}"
}

# The first pass always leaves the schedule disabled while credentials are updated.
deploy_stack false

SECRET_ARN="$(aws cloudformation describe-stacks \
  --profile "${AWS_PROFILE_NAME}" \
  --region "${AWS_REGION_NAME}" \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiSecretArn'].OutputValue" \
  --output text)"

jq -cn '{medusaApiKey:env.STAGING_OLIVE_CONVERSATIONS_API_KEY,connectApiKey:env.CONNECT_API_KEY_STAGING_MESSAGE_TEST}' \
| aws secretsmanager put-secret-value \
    --profile "${AWS_PROFILE_NAME}" \
    --region "${AWS_REGION_NAME}" \
    --secret-id "${SECRET_ARN}" \
    --secret-string file:///dev/stdin \
    --query VersionId \
    --output text >/dev/null

if [[ "${ENABLE_POLLER}" == "true" ]]; then
  deploy_stack true
fi

aws cloudformation describe-stacks \
  --profile "${AWS_PROFILE_NAME}" \
  --region "${AWS_REGION_NAME}" \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs' \
  --output table
