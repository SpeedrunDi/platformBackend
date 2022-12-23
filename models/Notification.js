const mongoose = require('mongoose')

const { Schema } = mongoose

const NotificationSchema = new Schema({
  description: {
    required: true,
    type: String,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
})

const Notification = mongoose.model('Notification', NotificationSchema)

module.exports = Notification
