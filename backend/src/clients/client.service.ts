import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './client.entity';
import { CreateClientDto, UpdateClientDto } from './client.dto';
import { User, UserRole } from '../user/user.entity';

@Injectable()
export class ClientService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
  ) {}

  private scopeWhere(user: User, extra: any = {}): any {
    if (user.role === UserRole.HYPER_ADMIN) return { ...extra };
    return { ...extra, organizationId: user.organizationId };
  }

  create(user: User, dto: CreateClientDto): Promise<Client> {
    const client = this.clientRepo.create({
      ...dto,
      organizationId: user.organizationId,
    });
    return this.clientRepo.save(client);
  }

  findAll(user: User): Promise<Client[]> {
    return this.clientRepo.find({
      where: this.scopeWhere(user),
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, user: User): Promise<Client> {
    const client = await this.clientRepo.findOne({
      where: this.scopeWhere(user, { id }),
    });
    if (!client) throw new NotFoundException('Client introuvable');
    return client;
  }

  async update(id: string, user: User, dto: UpdateClientDto): Promise<Client> {
    const client = await this.findOne(id, user);
    Object.assign(client, dto);
    return this.clientRepo.save(client);
  }

  async remove(id: string, user: User): Promise<void> {
    const client = await this.findOne(id, user);
    await this.clientRepo.remove(client);
  }
}
