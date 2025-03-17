import bodyParser from "body-parser";
import express from "express";
import axios from "axios";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import { generateRsaKeyPair, exportPrvKey, rsaDecrypt, importSymKey, symDecrypt } from "../crypto";

let lastReceivedEncryptedMessage: string | null = null;
let lastReceivedDecryptedMessage: string | null = null;
let lastMessageDestination: number | null = null;

async function generateKeyPair() {
  // Placeholder for key generation logic
  return {
    publicKey: "publicKeyString",
    privateKey: "privateKeyString",
  };
}

export async function simpleOnionRouter(nodeId: number) {
  const { publicKey, privateKey } = await generateRsaKeyPair();

  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  // Register the node on the registry
  await axios.post(`http://localhost:${REGISTRY_PORT}/registerNode`, {
    nodeId,
    pubKey: publicKey,
  });

  // Implement the status route
  onionRouter.get("/status", (req, res) => {
    res.status(200).send("live");
  });

  // Implement the getLastReceivedEncryptedMessage route
  onionRouter.get("/getLastReceivedEncryptedMessage", (req, res) => {
    res.status(200).json({ result: lastReceivedEncryptedMessage });
  });

  // Implement the getLastReceivedDecryptedMessage route
  onionRouter.get("/getLastReceivedDecryptedMessage", (req, res) => {
    res.status(200).json({ result: lastReceivedDecryptedMessage });
  });

  // Implement the getLastMessageDestination route
  onionRouter.get("/getLastMessageDestination", (req, res) => {
    res.status(200).json({ result: lastMessageDestination });
  });

  // Implement the message route
  onionRouter.post("/message", async (req, res) => {
    const { message } = req.body;
    lastReceivedEncryptedMessage = message;

    // Decrypt the RSA encrypted symmetric key
    const rsaEncryptedKey = message.slice(0, 344); // 344 is the length of RSA encrypted key in base64
    const symEncryptedMessage = message.slice(344);
    const decryptedSymKey = await rsaDecrypt(rsaEncryptedKey, privateKey);

    // Import the decrypted symmetric key
    const symmetricKey = await importSymKey(decryptedSymKey);

    // Decrypt the message with the symmetric key
    const decryptedMessage = await symDecrypt(decryptedSymKey, symEncryptedMessage);
    lastReceivedDecryptedMessage = decryptedMessage;

    // Extract the destination and the actual message
    const destination = parseInt(decryptedMessage.slice(0, 10), 10);
    const actualMessage = decryptedMessage.slice(10);
    lastMessageDestination = destination;

    // Forward the message to the next destination
    await axios.post(`http://localhost:${destination}/message`, { message: actualMessage });

    res.status(200).send("Message forwarded");
  });

  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(
      `Onion router ${nodeId} is listening on port ${
        BASE_ONION_ROUTER_PORT + nodeId
      }`
    );
  });

  return server;
}