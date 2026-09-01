export interface GeneratedImageRecord {
  userId: string;
  imageUrl: string;
  objectKey: string;
  prompt: string;
  provider: string;
  model: string;
}

export class GeneratedImageRepositoryError extends Error {
  public readonly name = "GeneratedImageRepositoryError";
  public readonly code = "insert_failed" as const;

  public constructor() {
    super("insert_failed");
  }
}

type GeneratedImageClient = {
  from(table: string): {
    insert(row: Record<string, string>): Promise<{ error: unknown }>;
  };
};

export function createGeneratedImageRepository(client: GeneratedImageClient) {
  return {
    async insert(record: GeneratedImageRecord): Promise<void> {
      try {
        const { error } = await client.from("generated_images").insert({
          user_id: record.userId,
          image_url: record.imageUrl,
          object_key: record.objectKey,
          prompt: record.prompt,
          provider: record.provider,
          model: record.model,
        });

        if (error) {
          throw new GeneratedImageRepositoryError();
        }
      } catch (error) {
        if (error instanceof GeneratedImageRepositoryError) {
          throw error;
        }
        throw new GeneratedImageRepositoryError();
      }
    },
  };
}
