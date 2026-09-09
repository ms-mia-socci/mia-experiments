import { fromIni } from "@aws-sdk/credential-providers";
export function awsConfig() {
  return {
    region: "us-east-1",
    ...(process.env.FIELDWORK_AWS_PROFILE
      ? {
          credentials: fromIni({
            profile: process.env.FIELDWORK_AWS_PROFILE,
            filepath: process.env.FIELDWORK_AWS_CREDENTIALS_FILE,
            configFilepath: process.env.FIELDWORK_AWS_CONFIG_FILE,
          }),
        }
      : {}),
  };
}
