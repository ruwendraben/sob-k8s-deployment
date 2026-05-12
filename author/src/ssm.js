const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

async function getParameter(name) {
  const client = new SSMClient({ region: process.env.AWS_REGION });
  const response = await client.send(
    new GetParameterCommand({ Name: name, WithDecryption: true })
  );
  return response.Parameter.Value;
}

module.exports = { getParameter };
