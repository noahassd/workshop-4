import bodyParser from "body-parser";
import express from "express";
import axios from "axios";
import { BASE_USER_PORT, REGISTRY_PORT } from "../config";
import { generateRsaKeyPair, exportPubKey, rsaEncrypt, createRandomSymmetricKey, exportSymKey, symEncrypt } from "../crypto";

export type SendMessageBody = {
  message: string;
  destinationUserId: number;
};

export type MessageBody = {
  message: string;
};

let lastReceivedMessage: string | null = null;
let lastSentMessage: string | null = null;

export async function user(userId: number) {
  const _user = express();
  _user.use(express.json());
  _user.use(bodyParser.json());

  _user.get("/status", (req, res) => {
    res.status(200).send("live");
  });

  _user.get("/getLastReceivedMessage", (req, res) => {
    res.status(200).json({ result: lastReceivedMessage });
  });

  _user.get("/getLastSentMessage", (req, res) => {
    res.status(200).json({ result: lastSentMessage });
  });

  _user.post("/message", (req, res) => {
    const { message } = req.body as MessageBody;
    lastReceivedMessage = message;
    res.status(200).send("Message received");
  });

  _user.post("/sendMessage", async (req, res) => {
    const { message, destinationUserId } = req.body as SendMessageBody;

    // Fetch the node registry
    const registryResponse = await axios.get(`http://localhost:${REGISTRY_PORT}/getNodeRegistry`);
    const nodes = registryResponse.data.nodes;

    // Select 3 distinct nodes randomly
    const selectedNodes: { nodeId: number; pubKey: string }[] = [];
    while (selectedNodes.length < 3) {
      const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
      if (!selectedNodes.includes(randomNode)) {
        selectedNodes.push(randomNode);
      }
    }

    // Create a unique symmetric key for each node
    const symmetricKeys = await Promise.all(selectedNodes.map(() => createRandomSymmetricKey()));

    // Create each layer of encryption
    let encryptedMessage = message;
    for (let i = selectedNodes.length - 1; i >= 0; i--) {
      const node = selectedNodes[i];
      const symmetricKey = symmetricKeys[i];
      const destination = (i === selectedNodes.length - 1) ? destinationUserId : BASE_USER_PORT + selectedNodes[i + 1].nodeId;
      const destinationString = destination.toString().padStart(10, '0');

      // Encrypt the message with the symmetric key
      const symEncryptedMessage = await symEncrypt(symmetricKey, destinationString + encryptedMessage);

      // Encrypt the symmetric key with the node's public key
      const rsaEncryptedKey = await rsaEncrypt(await exportSymKey(symmetricKey), node.pubKey);

      // Concatenate the encrypted symmetric key and the encrypted message
      encryptedMessage = rsaEncryptedKey + symEncryptedMessage;
    }

    // Forward the encrypted message to the entry node
    await axios.post(`http://localhost:${BASE_USER_PORT + selectedNodes[0].nodeId}/message`, { message: encryptedMessage });

    lastSentMessage = message;
    res.status(200).send("Message sent");
  });

  const server = _user.listen(BASE_USER_PORT + userId, () => {
    console.log(`User ${userId} is listening on port ${BASE_USER_PORT + userId}`);
  });

  return server;
}
