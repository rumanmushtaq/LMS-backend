import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/varona-academy';

async function checkTutors() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const UserSchema = new mongoose.Schema(
      {
        role: String,
        status: String,
        email: String,
        firstName: String,
        lastName: String,
      },
      { strict: false },
    );

    const User = mongoose.model('User', UserSchema);

    const tutors = await User.find({ role: 'tutor' });
    console.log(`Found ${tutors.length} tutors:`);
    tutors.forEach((t) =>
      console.log(
        `- ${t.firstName} ${t.lastName} (${t.email}), Status: ${t.status}`,
      ),
    );

    const allUsers = await User.countDocuments();
    console.log(`Total users in DB: ${allUsers}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkTutors();
