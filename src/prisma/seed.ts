import { PrismaClient, Role } from '../generated/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // 1. Create Platform Admin (hidden system role)
  let platformAdmin = await prisma.user.findFirst({
    where: { role: Role.PLATFORM_ADMIN },
  });

  if (!platformAdmin) {
    const passwordHash = await bcrypt.hash('Admin@12345', 12);
    platformAdmin = await prisma.user.create({
      data: {
        email: 'admin@etapalwala.gov.in',
        username: 'platformadmin',
        passwordHash,
        fullName: 'Platform Administrator',
        phone: '+919999999999',
        role: Role.PLATFORM_ADMIN,
        isActive: true,
      },
    });
    console.log('✅ Platform Admin created:', platformAdmin.email);
  } else {
    console.log('ℹ️  Platform Admin already exists:', platformAdmin.email);
  }

  // 2. Create Nagpur City
  let nagpurCity = await prisma.city.findUnique({
    where: { code: 'NGP' },
  });

  if (!nagpurCity) {
    nagpurCity = await prisma.city.create({
      data: {
        name: 'Nagpur',
        code: 'NGP',
        state: 'Maharashtra',
        district: 'Nagpur',
        isActive: true,
        createdById: platformAdmin.id,
      },
    });
    console.log('✅ Nagpur city created');
  } else {
    console.log('ℹ️  Nagpur city already exists');
  }

  // 3. Create Nagpur Offices
  let collectorOffice = await prisma.office.findUnique({
    where: { code: 'COLLECTOR_NGP' },
  });
  if (!collectorOffice) {
    collectorOffice = await prisma.office.create({
      data: {
        name: 'District Collector Office',
        code: 'COLLECTOR_NGP',
        cityId: nagpurCity.id,
      },
    });
    console.log('✅ Collector Office created');
  }

  let zpOffice = await prisma.office.findUnique({
    where: { code: 'ZP_NGP' },
  });
  if (!zpOffice) {
    zpOffice = await prisma.office.create({
      data: {
        name: 'Zilla Parishad Office',
        code: 'ZP_NGP',
        cityId: nagpurCity.id,
      },
    });
    console.log('✅ Zilla Parishad Office created');
  }

  // 4. Create Nagpur Collector Office Admin
  let nagpurAdmin = await prisma.user.findUnique({
    where: { email: 'piyush@gmail.co' },
  });

  if (!nagpurAdmin) {
    const passwordHash = await bcrypt.hash('Piyu@123', 12);
    nagpurAdmin = await prisma.user.create({
      data: {
        email: 'piyush@gmail.co',
        username: 'piyush_admin',
        passwordHash,
        fullName: 'Piyush Admin (Collector Office)',
        phone: '+918888888888',
        role: Role.Admin,
        cityId: nagpurCity.id,
        officeId: collectorOffice.id,
        isActive: true,
      },
    });
    console.log('✅ Nagpur Collector Admin (piyush@gmail.co) created');
  } else {
    // ensure it has officeId
    if (!nagpurAdmin.officeId) {
      nagpurAdmin = await prisma.user.update({
        where: { id: nagpurAdmin.id },
        data: { officeId: collectorOffice.id },
      });
    }
    console.log('ℹ️  Nagpur Collector Admin already exists:', nagpurAdmin.email);
  }

  // 5. Create Nagpur Zilla Parishad Office Admin
  let zpAdmin = await prisma.user.findUnique({
    where: { email: 'zp_admin@gmail.co' },
  });

  if (!zpAdmin) {
    const passwordHash = await bcrypt.hash('Admin@12345', 12);
    zpAdmin = await prisma.user.create({
      data: {
        email: 'zp_admin@gmail.co',
        username: 'zp_admin',
        passwordHash,
        fullName: 'ZP Admin Office',
        phone: '+918888888889',
        role: Role.Admin,
        cityId: nagpurCity.id,
        officeId: zpOffice.id,
        isActive: true,
      },
    });
    console.log('✅ Nagpur ZP Admin (zp_admin@gmail.co) created');
  }

  // 6. Create Departments in Collector Office
  let revenueDept = await prisma.department.findFirst({
    where: { code: 'REVENUE', officeId: collectorOffice.id },
  });

  if (!revenueDept) {
    revenueDept = await prisma.department.create({
      data: {
        name: 'Revenue Branch',
        code: 'REVENUE',
        cityId: nagpurCity.id,
        officeId: collectorOffice.id,
        headOfDepartmentId: nagpurAdmin.id,
      },
    });
    console.log('✅ Revenue Branch department created in Collector Office');
  }

  let landRecDept = await prisma.department.findFirst({
    where: { code: 'LAND_REC', officeId: collectorOffice.id },
  });

  if (!landRecDept) {
    landRecDept = await prisma.department.create({
      data: {
        name: 'Land Records Branch',
        code: 'LAND_REC',
        cityId: nagpurCity.id,
        officeId: collectorOffice.id,
      },
    });
    console.log('✅ Land Records Branch department created in Collector Office');
  }

  // 7. Create Nagpur Operator in Collector Office
  let nagpurOperator = await prisma.user.findUnique({
    where: { email: 'raj@gmail.com' },
  });

  if (!nagpurOperator) {
    const passwordHash = await bcrypt.hash('Raj@123', 12);
    nagpurOperator = await prisma.user.create({
      data: {
        email: 'raj@gmail.com',
        username: 'raj_operator',
        passwordHash,
        fullName: 'Raj Operator',
        phone: '+917777777777',
        role: Role.Clerk,
        cityId: nagpurCity.id,
        officeId: collectorOffice.id,
        departmentId: revenueDept.id,
        deskName: 'Desk-1 (Revenue Inward)',
        isActive: true,
      },
    });

    await prisma.operator.create({
      data: {
        userId: nagpurOperator.id,
        cityId: nagpurCity.id,
        createdById: nagpurAdmin.id,
      },
    });
    console.log('✅ Nagpur Collector Operator (raj@gmail.com) created');
  } else {
    // Ensure it has officeId and departmentId
    if (!nagpurOperator.officeId || !nagpurOperator.departmentId) {
      nagpurOperator = await prisma.user.update({
        where: { id: nagpurOperator.id },
        data: {
          officeId: collectorOffice.id,
          departmentId: revenueDept.id,
          deskName: 'Desk-1 (Revenue Inward)',
        },
      });
    }
    console.log('ℹ️  Nagpur Collector Operator already exists:', nagpurOperator.email);
  }

  // 8. Create global messaging settings placeholder
  const existingSettings = await prisma.messagingSettings.findFirst({
    where: { scope: 'GLOBAL' },
  });

  if (!existingSettings) {
    await prisma.messagingSettings.create({
      data: {
        scope: 'GLOBAL',
        metaApiVersion: 'v19.0',
        preferredProvider: 'META',
      },
    });
    console.log('✅ Global messaging settings created');
  }

  console.log('🎉 Seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
