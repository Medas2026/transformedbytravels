module.exports = function handler(req, res) {
  res.status(200).json({
    hasKey: !!process.env.ANTHROPIC_API_KEY,
    keyLength: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.length : 0,
    nodeVersion: process.version
  });
};
