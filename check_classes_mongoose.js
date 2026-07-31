const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: String,
  status: String,
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const ClassSession = mongoose.model('ClassSession', classSchema);

mongoose.connect('mongodb+srv://rumanmdev_db_user:S65uKGqzPQDNhYNl@cluster0.yhbeei2.mongodb.net/test')
  .then(async () => {
    console.log("Connected to MongoDB.");
    const classes = await ClassSession.find({}).exec();
    console.log(`Found ${classes.length} classes:`);
    console.log(JSON.stringify(classes, null, 2));
    mongoose.disconnect();
  })
  .catch(err => {
    console.error(err);
    mongoose.disconnect();
  });
