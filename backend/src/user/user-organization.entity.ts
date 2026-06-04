import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User, UserRole } from '../user/user.entity';
import { Organization } from '../organizations/organization.entity';

/**
 * Used only when MULTI_ORG_USERS_ENABLED=true in .env.
 * Allows one coordinator (USER) to belong to multiple organizations.
 * When the flag is false, we use users.organizationId directly.
 */
@Entity('user_organizations')
export class UserOrganization {
  @PrimaryColumn('uuid')
  userId: string;

  @PrimaryColumn('uuid')
  organizationId: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @CreateDateColumn()
  createdAt: Date;
}
