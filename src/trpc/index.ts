import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { privateProcedure, publicProcedure, router } from "./trpc";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { deleteObject, ref } from "firebase/storage";
import { storage } from "@/db/firebase";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";
import { PineconeStore } from "@langchain/pinecone";

import { pinecone } from "@/lib/pinecone";
import { INFINITE_QUERY_LIMIT } from "@/config/infinite-query";
import { absoluteUrl } from "@/lib/utils";
import { getUserSubscriptionPlan, stripe } from "@/lib/stripe";
import { PLANS } from "@/config/stripe";

export const generateNewObjectId = () => {
  return new ObjectId().toString();
};

export const appRouter = router({
  authCallback: publicProcedure.query(async () => {
    const { getUser } = getKindeServerSession();
    const user = await getUser();

    if (!user || !user.id || !user.email) {
      throw new TRPCError({ code: "BAD_REQUEST" });
    }

    const dbUser = await db.user.findFirst({
      where: {
        kid: user.id,
      },
    });

    if (!dbUser) {
      await db.user.create({
        data: {
          kid: user.id,
          mid: generateNewObjectId(),
          email: user.email,
        },
      });
    }

    return { success: true };
  }),
  getUserFiles: privateProcedure.query(async ({ ctx }) => {
    const { userId } = ctx;
    return await db.file.findMany({
      where: {
        userId,
      },
    });
  }),
  getFileUploadStatus: privateProcedure.input(z.object({ fileId: z.string() })).query(async ({ input, ctx }) => {
    const file = await db.file.findFirst({
      where: {
        id: input.fileId,
        userId: ctx.userId,
      },
    });

    if (!file) return { status: "PENDING" as const };

    return { status: file.uploadStatus };
  }),
  deleteFile: privateProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { userId } = ctx;

    const file = await db.file.findFirst({
      where: {
        id: input.id,
        userId,
      },
    });

    if (!file) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    await db.file.delete({
      where: {
        id: input.id,
      },
    });

    const storageRef = ref(storage, `${ctx.userId}/${file.name}`);
    await deleteObject(storageRef);

    return file;
  }),
  saveFile: privateProcedure
    .input(z.object({ key: z.string(), fileName: z.string(), url: z.string() }))
    .mutation(async ({ ctx, input: { key, fileName, url } }) => {
      const createdFile = await db.file.create({
        data: {
          key,
          name: fileName,
          userId: ctx.userId,
          url,
          uploadStatus: "PROCESSING",
        },
      });

      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const loader = new PDFLoader(blob);
        const pageLevelDocs = await loader.load();
        const pagesAmt = pageLevelDocs.length;
        const pineconeIndex = pinecone.Index("quill");

        const embeddings = new VoyageEmbeddings({
          apiKey: process.env.VOYAGE_AI_API_KEY,
          modelName: "voyage-code-2",
        });

        const pcStoreRes = await PineconeStore.fromDocuments(pageLevelDocs, embeddings, {
          pineconeIndex,
          namespace: createdFile.id,
        });

        await db.file.update({
          data: {
            uploadStatus: "SUCCESS",
          },
          where: {
            id: createdFile.id,
          },
        });
        return createdFile.key;
      } catch (e) {
        console.log(e);
        await db.file.update({
          data: {
            uploadStatus: "FAILED",
          },
          where: {
            id: createdFile.id,
          },
        });
      }
    }),
  getFile: privateProcedure.input(z.object({ key: z.string() })).mutation(async ({ ctx, input }) => {
    const { userId } = ctx;
    const file = await db.file.findFirst({
      where: {
        key: input.key,
        userId,
      },
    });
    if (!file) throw new TRPCError({ code: "NOT_FOUND" });
    return file;
  }),
  getFileMessages: privateProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).nullish(),
        cursor: z.string().nullish(),
        fileId: z.string(),
      })
    )
    .query(async ({ ctx: { userId }, input }) => {
      const limit = input.limit || INFINITE_QUERY_LIMIT;
      const file = await db.file.findFirst({
        where: {
          id: input.fileId,
          userId,
        },
      });
      if (!file) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const messages = await db.message.findMany({
        take: limit + 1,
        where: {
          fileId: input.fileId,
        },
        orderBy: {
          createdAt: "desc",
        },
        cursor: input.cursor ? { id: input.cursor } : undefined,
        select: {
          id: true,
          isUserMessage: true,
          createdAt: true,
          text: true,
        },
      });
      let nextCursor: typeof input.cursor | undefined = undefined;
      if (messages.length > limit) {
        const nextItem = messages.pop();
        nextCursor = nextItem?.id;
      }

      return {
        messages,
        nextCursor,
      };
    }),
  createStripeSession: privateProcedure.mutation(async ({ ctx }) => {
    const { userId } = ctx;
    const billingUrl = absoluteUrl("/dashboard/billing");
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    const dbUser = await db.user.findFirst({
      where: {
        kid: userId,
      },
    });

    if (!dbUser) throw new TRPCError({ code: "UNAUTHORIZED" });

    const subscriptionPlan = await getUserSubscriptionPlan();

    if (subscriptionPlan.isSubscribed && dbUser.stripeCustomerId) {
      const stripeSession = await stripe.billingPortal.sessions.create({
        customer: dbUser.stripeCustomerId,
        return_url: billingUrl,
      });

      return {
        url: stripeSession.url,
      };
    }

    const stripeSession = await stripe.checkout.sessions.create({
      success_url: billingUrl,
      cancel_url: billingUrl,
      payment_method_types: ["card", "paypal", "amazon_pay"],
      mode: "subscription",
      billing_address_collection: "auto",
      line_items: [
        {
          price: PLANS.find((plan) => plan.name === "Pro")?.price.priceIds.test,
          quantity: 1,
        },
      ],
      metadata: {
        userId,
      },
    });
    return { url: stripeSession.url };
  }),
});

export type AppRouter = typeof appRouter;
