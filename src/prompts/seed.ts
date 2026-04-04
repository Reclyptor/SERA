/**
 * Seed script for the system prompt.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/prompts/seed.ts
 *
 * Upserts the "system" prompt in MongoDB. Safe to run multiple times —
 * it will overwrite the existing content.
 */
import { connect, model, Schema } from 'mongoose';
import { DEFAULT_SYSTEM_PROMPT } from './defaults';

const PromptSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true, collection: 'prompts' },
);

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI environment variable is required');
    process.exit(1);
  }

  await connect(uri);
  const Prompt = model('Prompt', PromptSchema);

  await Prompt.findOneAndUpdate(
    { slug: 'system' },
    {
      content: DEFAULT_SYSTEM_PROMPT,
      metadata: { description: 'Main agent system prompt' },
    },
    { upsert: true },
  );

  console.log('Seeded "system" prompt');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
