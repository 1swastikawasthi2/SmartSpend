const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema({
    userId: { type: String, default: 'default_user' },
    failedInput: { type: Object },
    errorMessage: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ErrorLog', errorLogSchema);
    