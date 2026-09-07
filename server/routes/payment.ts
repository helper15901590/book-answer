import { Express } from 'express';
import { db } from '../../src/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { OrderLog, MembershipTier } from '../../src/types.js';

export function registerPaymentRoutes(app: Express): void {
  // =========================================================================
  // 7. Membership Order & Commercial Payment APIs
  // =========================================================================
  app.post('/api/payment/create-membership-order', (req: AuthRequest, res) => {
    const { planType, paymentMethod, userId } = req.body;
    let targetUser = req.user || (userId ? db.getUserById(userId) : null);

    if (!targetUser || targetUser.role === 'guest') {
      return res.status(401).json({ error: '请先登录会员账号再进行会员订阅' });
    }

    const config = db.getLLMConfig();
    const plans = config.membershipPlans || {
      monthlyPrice: 29.9,
      quarterlyPrice: 69.9,
      yearlyPrice: 199.0,
    };

    let amount = plans.monthlyPrice;
    let planName = '月度会员 (30天)';
    let normalizedPlan: 'monthly' | 'quarterly' | 'yearly' = 'monthly';

    if (planType === 'quarterly') {
      normalizedPlan = 'quarterly';
      amount = plans.quarterlyPrice;
      planName = '季度会员 (90天)';
    } else if (planType === 'yearly') {
      normalizedPlan = 'yearly';
      amount = plans.yearlyPrice;
      planName = '年度会员 (365天)';
    }

    const tradeNo = 'VIP_' + Date.now() + '_' + Math.floor(Math.random() * 899 + 100);
    const order: OrderLog = {
      id: 'ord-' + Date.now(),
      tradeNo,
      userId: targetUser.id,
      unionId: targetUser.unionId,
      planType: normalizedPlan,
      planName,
      amount,
      type: 'membership',
      paymentMethod: paymentMethod || 'wechat',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    db.createOrder(order);

    res.json({
      success: true,
      order,
      qrCodeData: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PAY_${tradeNo}`,
      message: `订单创建成功，请扫码完成支付`,
    });
  });

  // Backward compatibility alias for create-order
  app.post('/api/payment/create-order', (req: AuthRequest, res) => {
    const { planType, paymentMethod, userId } = req.body;
    let targetUser = req.user || (userId ? db.getUserById(userId) : null);

    if (!targetUser || targetUser.role === 'guest') {
      return res.status(401).json({ error: '请先登录会员账号' });
    }

    const config = db.getLLMConfig();
    const plans = config.membershipPlans || {
      monthlyPrice: 29.9,
      quarterlyPrice: 69.9,
      yearlyPrice: 199.0,
    };

    let amount = plans.monthlyPrice;
    let planName = '月度会员 (30天)';
    let normalizedPlan: 'monthly' | 'quarterly' | 'yearly' = 'monthly';

    if (planType === 'quarterly') {
      normalizedPlan = 'quarterly';
      amount = plans.quarterlyPrice;
      planName = '季度会员 (90天)';
    } else if (planType === 'yearly') {
      normalizedPlan = 'yearly';
      amount = plans.yearlyPrice;
      planName = '年度会员 (365天)';
    }

    const tradeNo = 'VIP_' + Date.now() + '_' + Math.floor(Math.random() * 899 + 100);
    const order: OrderLog = {
      id: 'ord-' + Date.now(),
      tradeNo,
      userId: targetUser.id,
      unionId: targetUser.unionId,
      planType: normalizedPlan,
      planName,
      amount,
      type: 'membership',
      paymentMethod: paymentMethod || 'wechat',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    db.createOrder(order);

    res.json({
      success: true,
      order,
      qrCodeData: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PAY_${tradeNo}`,
      message: `订单创建成功`,
    });
  });

  // Polling order status
  app.get('/api/payment/order-status/:tradeNo', (req, res) => {
    const order = db.getOrderByTradeNo(req.params.tradeNo);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const user = order.userId ? db.getUserById(order.userId) : null;
    res.json({
      tradeNo: order.tradeNo,
      status: order.status,
      paidAt: order.paidAt,
      user,
    });
  });

  // Test / Sandbox Instant Checkout
  app.post('/api/payment/simulate-pay', (req: AuthRequest, res) => {
    const { tradeNo, planType, userId } = req.body;
    const uid = req.user?.id || userId;
    let targetOrder: OrderLog | undefined;

    if (tradeNo) {
      targetOrder = db.getOrderByTradeNo(tradeNo);
    }

    if (targetOrder) {
      const updated = db.updateOrderStatus(targetOrder.id, 'success');
      const user = updated?.userId ? db.getUserById(updated.userId) : null;
      return res.json({ success: true, order: updated, user });
    }

    if (uid) {
      const user = db.getUserById(uid);
      if (user) {
        const config = db.getLLMConfig();
        const plans = config.membershipPlans || {
          monthlyPrice: 29.9,
          quarterlyPrice: 69.9,
          yearlyPrice: 199.0,
        };

        const targetPlan = planType === 'quarterly' ? 'quarterly' : planType === 'yearly' ? 'yearly' : 'monthly';
        const amount = targetPlan === 'quarterly' ? plans.quarterlyPrice : targetPlan === 'yearly' ? plans.yearlyPrice : plans.monthlyPrice;
        const planName = targetPlan === 'quarterly' ? '季度会员 (90天)' : targetPlan === 'yearly' ? '年度会员 (365天)' : '月度会员 (30天)';

        const newTradeNo = 'VIP_' + Date.now() + '_' + Math.floor(Math.random() * 899 + 100);
        const order: OrderLog = {
          id: 'ord-' + Date.now(),
          tradeNo: newTradeNo,
          userId: user.id,
          unionId: user.unionId,
          planType: targetPlan,
          planName,
          amount,
          type: 'membership',
          paymentMethod: 'wechat',
          status: 'success',
          createdAt: new Date().toISOString(),
          paidAt: new Date().toISOString(),
        };

        db.createOrder(order);

        let tier: MembershipTier = 'monthly_member';
        let days = 30;
        if (targetPlan === 'quarterly') {
          tier = 'quarterly_member';
          days = 90;
        } else if (targetPlan === 'yearly') {
          tier = 'yearly_member';
          days = 365;
        }

        const updatedUser = db.upgradeUserMembership(user.id, tier, days);
        return res.json({ success: true, order, user: updatedUser });
      }
    }

    res.status(400).json({ error: '无效的支付请求参数' });
  });

  // Webhook for real payment callbacks (e.g. WeChat Pay / Alipay)
  app.post('/api/payment/webhook', (req, res) => {
    const { tradeNo, status } = req.body;
    if (!tradeNo) {
      return res.status(400).json({ error: 'Missing tradeNo' });
    }
    const updated = db.updateOrderStatus(tradeNo, status === 'failed' ? 'failed' : 'success');
    res.json({ success: true, order: updated });
  });

  app.get('/api/payment/orders', (req: AuthRequest, res) => {
    const uid = req.user?.id || (typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const orders = db.getOrders(uid);
    res.json({ orders });
  });
}
