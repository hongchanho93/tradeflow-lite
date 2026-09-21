import boll from './boll.indicator';
import ema from './ema.indicator';
import ma from './ma.indicator';
import macd from './macd.indicator';
import rsi from './rsi.indicator';

export const builtinIndicators = [ma, ema, boll, macd, rsi] as const;
