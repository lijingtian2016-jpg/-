import { describe, expect, it, vi } from "vitest";

import {
  createGeneratedImageRepository,
  GeneratedImageRepositoryError,
  type GeneratedImageRecord,
} from "./generated-image-repository";

const record: GeneratedImageRecord = {
  userId: "user-1",
  imageUrl: "https://cdn.example.com/images/user-1/id.jpeg",
  objectKey: "images/user-1/id.jpeg",
  prompt: "a paper doll boyfriend",
  provider: "volcengine-ark",
  model: "seedream-model",
};

describe("createGeneratedImageRepository", () => {
  it("inserts exact generated image metadata and resolves successfully", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));
    const repository = createGeneratedImageRepository({ from });

    await expect(repository.insert(record)).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("generated_images");
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      image_url: "https://cdn.example.com/images/user-1/id.jpeg",
      object_key: "images/user-1/id.jpeg",
      prompt: "a paper doll boyfriend",
      provider: "volcengine-ark",
      model: "seedream-model",
    });
  });

  it("wraps returned database errors without exposing raw details", async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { message: "duplicate key: secret database detail" },
    });
    const repository = createGeneratedImageRepository({
      from: vi.fn(() => ({ insert })),
    });

    const operation = repository.insert(record);

    await expect(operation).rejects.toMatchObject({
      name: "GeneratedImageRepositoryError",
      code: "insert_failed",
      message: "insert_failed",
    });
    await expect(operation).rejects.not.toHaveProperty("cause");
  });

  it("wraps thrown client failures without exposing raw details", async () => {
    const repository = createGeneratedImageRepository({
      from: vi.fn(() => ({
        insert: vi.fn().mockRejectedValue(new Error("connection secret")),
      })),
    });

    const operation = repository.insert(record);

    await expect(operation).rejects.toBeInstanceOf(
      GeneratedImageRepositoryError,
    );
    await expect(operation).rejects.toMatchObject({
      code: "insert_failed",
      message: "insert_failed",
    });
    await expect(operation).rejects.not.toHaveProperty("cause");
  });
});
