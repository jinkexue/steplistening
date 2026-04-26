-- 为vocab表添加SM-2算法所需字段
-- 执行方式: 在Cloudflare Dashboard的D1控制台中运行，或通过wrangler d1 execute命令

-- 添加 efactor (简易度系数) 列，默认2.5
ALTER TABLE vocab ADD COLUMN efactor REAL DEFAULT 2.5;

-- 添加 interval (当前间隔天数) 列，默认0
ALTER TABLE vocab ADD COLUMN interval INTEGER DEFAULT 0;

-- 添加 repetitions (连续成功次数) 列，默认0
ALTER TABLE vocab ADD COLUMN repetitions INTEGER DEFAULT 0;

-- 验证迁移结果
SELECT name, type FROM pragma_table_info('vocab') WHERE name IN ('efactor', 'interval', 'repetitions');
