module.exports = function handler(req, res) {
  const allKeys = Object.keys(process.env).filter(k =>
    !k.startsWith('npm_') && !k.startsWith('NEXT_') && k !== 'PATH' && k !== 'HOME'
  );
  res.status(200).json({
    hasKey: !!process.env.ANTHROPIC_API_KEY,
    keyLength: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.length : 0,
    availableEnvKeys: allKeys
  });
};
