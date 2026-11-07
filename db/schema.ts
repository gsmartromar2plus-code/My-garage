import { pgTable, text, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';
export const garages = pgTable('garages', {
  id: text('id').primaryKey(),
  data: jsonb('data').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
export const revisions = pgTable('garage_revisions', {
  id: text('id').primaryKey(),
  garageId: text('garage_id').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
