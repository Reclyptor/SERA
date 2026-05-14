import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Commitment, CommitmentDocument } from './commitment.schema';

@Injectable()
export class CommitmentsService {
  private readonly logger = new Logger(CommitmentsService.name);

  constructor(
    @InjectModel(Commitment.name)
    private readonly commitmentModel: Model<CommitmentDocument>,
  ) {}

  async create(data: {
    agentID: string;
    userID: string;
    description: string;
    dueAt?: Date;
    reminderAt?: Date;
    sourceRunID?: string;
    sourceThreadID?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<Commitment> {
    return this.commitmentModel.create({
      commitmentID: randomUUID(),
      ...data,
      tags: data.tags ?? [],
      metadata: data.metadata ?? {},
    });
  }

  async findPending(agentID: string): Promise<Commitment[]> {
    return this.commitmentModel
      .find({ agentID, status: 'pending' })
      .sort({ dueAt: 1, createdAt: 1 })
      .exec();
  }

  async findDue(agentID: string, now?: Date): Promise<Commitment[]> {
    const cutoff = now ?? new Date();
    return this.commitmentModel
      .find({
        agentID,
        status: 'pending',
        $or: [
          { dueAt: { $lte: cutoff } },
          { reminderAt: { $lte: cutoff } },
        ],
      })
      .sort({ dueAt: 1 })
      .exec();
  }

  async complete(
    commitmentID: string,
    completionRunID?: string,
  ): Promise<Commitment | null> {
    return this.commitmentModel
      .findOneAndUpdate(
        { commitmentID },
        {
          $set: {
            status: 'completed',
            ...(completionRunID && { completionRunID }),
          },
        },
        { new: true },
      )
      .exec();
  }

  async cancel(commitmentID: string): Promise<Commitment | null> {
    return this.commitmentModel
      .findOneAndUpdate(
        { commitmentID },
        { $set: { status: 'cancelled' } },
        { new: true },
      )
      .exec();
  }

  async expire(gracePeriodMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - gracePeriodMs);
    const result = await this.commitmentModel.updateMany(
      {
        status: 'pending',
        dueAt: { $lte: cutoff },
      },
      { $set: { status: 'expired' } },
    );
    return result.modifiedCount;
  }

  async findAll(filters?: {
    agentID?: string;
    userID?: string;
    status?: string;
  }): Promise<Commitment[]> {
    const query: Record<string, unknown> = {};
    if (filters?.agentID) query.agentID = filters.agentID;
    if (filters?.userID) query.userID = filters.userID;
    if (filters?.status) query.status = filters.status;
    return this.commitmentModel.find(query).sort({ createdAt: -1 }).exec();
  }
}
