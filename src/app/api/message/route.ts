import { db } from "@/db";
import { SendMessageValidator } from "@/lib/validators/SendMessageValidator";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { NextRequest } from "next/server";
import { pinecone } from "@/lib/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { anthropic } from "@/lib/antropic";
import { StreamingTextResponse, streamText } from "ai";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";

export const POST = async (req: NextRequest) => {
  const body = await req.json();
  const { getUser } = getKindeServerSession();
  const user = await getUser();

  if (!user || !user.id) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const { fileId, message } = SendMessageValidator.parse(body);

  const file = db.file.findFirst({
    where: {
      id: fileId,
      userId: user.id,
    },
  });

  if (!file) {
    throw new Response("Not found", { status: 404 });
  }

  await db.message.create({
    data: {
      text: message,
      isUserMessage: true,
      userId: user.id,
      fileId,
    },
  });

  const embeddings = new VoyageEmbeddings({
    apiKey: process.env.VOYAGE_AI_API_KEY,
    modelName: "voyage-code-2",
  });

  // const pinecone = await getPineconeClient();
  const pineconeIndex = pinecone.index("quill");

  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    namespace: fileId,
  });

  const results = await vectorStore.similaritySearch(message, 4);

  const prevMessage = await db.message.findMany({
    where: {
      fileId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 6,
  });

  const formattedPrevMessages = prevMessage.map((msg) => ({
    role: msg.isUserMessage ? ("user" as const) : ("assistant" as const),
    content: msg.text,
  }));

  const response = await streamText({
    model: anthropic("claude-3-sonnet-20240229"),
    messages: [
      {
        role: "system",
        content: "Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format.",
      },
      {
        role: "user",
        content: `Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format. \nIf you don't know the answer, just say that you don't know, don't try to make up an answer.
          
    \n----------------\n
    
    PREVIOUS CONVERSATION:
    ${formattedPrevMessages.map((message) => {
      if (message.role === "user") return `User: ${message.content}\n`;
      return `Assistant: ${message.content}\n`;
    })}
    
    \n----------------\n
    
    CONTEXT:
    ${results.map((r) => r.pageContent).join("\n\n")}
    
    USER INPUT: ${message}`,
      },
    ],
    onFinish: async ({ text }) => {
      await db.message.create({
        data: {
          text,
          isUserMessage: false,
          fileId,
          userId: user.id,
        },
      });
    },
  });

  return new StreamingTextResponse(response.toAIStream());
};
