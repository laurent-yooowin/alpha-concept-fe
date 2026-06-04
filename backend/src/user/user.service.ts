import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './user.entity';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './user.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    const existingUser = await this.userRepository.findOne({
      where: { email: userData.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const user = this.userRepository.create({
      ...userData,
      password: hashedPassword,
    });

    return this.userRepository.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Org-scoped listing.
   * - HYPER_ADMIN: sees everything (optional org filter)
   * - ADMIN: sees users of its own organization
   * - USER: sees self only
   */
  async findAll(currentUser?: User, organizationId?: string): Promise<User[]> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id', 'user.email', 'user.firstName', 'user.lastName',
        'user.role', 'user.phone', 'user.company', 'user.experience',
        'user.isActive', 'user.organizationId', 'user.permissions', 'user.createdAt',
      ]);

    if (!currentUser) return qb.getMany();

    if (currentUser.role === UserRole.HYPER_ADMIN) {
      if (organizationId) qb.where('user.organizationId = :oid', { oid: organizationId });
    } else if (currentUser.role === UserRole.ADMIN) {
      qb.where('user.organizationId = :oid', { oid: currentUser.organizationId })
        .andWhere('user.role != :hyper', { hyper: UserRole.HYPER_ADMIN });
    } else {
      qb.where('user.id = :id', { id: currentUser.id });
    }

    return qb.getMany();
  }

  async update(id: string, userData: UpdateUserDto | { password: string }): Promise<User> {
    const user = await this.findById(id);

    if (userData.password) {
      userData.password = await bcrypt.hash(userData.password, 10);
    }

    Object.assign(user, userData);
    return this.userRepository.save(user);
  }

  async delete(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.userRepository.remove(user);
  }

  async validatePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}
