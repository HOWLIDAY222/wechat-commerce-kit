import { withTapFeedback } from '../../utils/tap-feedback';
import { operationsPage, readPendingMemberAction, savePendingMemberAction, clearPendingMemberAction } from '../../utils/member-operations-page';
import { createMemberRequestId } from '../../models/member-operations';

Page(withTapFeedback({
  ...operationsPage({ route: '/pages/member-lottery/index', loaded(overview) {
    if (this.pendingIdentity !== this.overviewIdentity) { this.pendingDraw = readPendingMemberAction('draw'); this.pendingIdentity = this.overviewIdentity; }
    this.setData({ lotteries: overview.lotteries.map(item => ({ ...item, retryPending: this.pendingDraw?.target === item.id, canAttempt: item.canDraw || !!(overview.registered && this.pendingDraw?.target === item.id) })) });
  } }),
  data: { overview: null, loading: false, busy: false, guest: false, syncFailed: false, error: '', notice: '', lotteries: [], result: null },
  async draw(event) {
    if (!this.canOperate() || this.confirmingDraw) return;
    const lottery = this.data.lotteries.find(item => item.id === event.currentTarget.dataset.id);
    if (!lottery?.canAttempt || (!lottery.enabled && !lottery.retryPending)) return;
    if (this.pendingDraw && this.pendingDraw.target !== lottery.id) { this.setData({ error: '上次参与结果尚未确认，请先核对原活动的结果。' }); return; }
    this.confirmingDraw = true;
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const decision = await new Promise((resolve, reject) => wx.showModal({ title: this.pendingDraw ? '核对上次参与结果' : '确认使用积分', content: this.pendingDraw ? '会沿用上次请求编号核对结果，不会因重试再次扣除积分。' : `参与「${lottery.title}」将使用 ${lottery.costPoints} 积分。是否继续？`, confirmText: this.pendingDraw ? '核对结果' : '确认参与', success: resolve, fail: reject }));
      if (!decision.confirm || this.disposed) return;
      this.setData({ busy: false });
      if (!this.canOperate()) return;
      this.pendingDraw ||= { target: lottery.id, requestId: createMemberRequestId() };
      savePendingMemberAction('draw', this.pendingDraw);
      const result = await this.performOperation('draw', { lotteryId: lottery.id, requestId: this.pendingDraw.requestId }, '参与结果已返回，请核对下方记录及最新余额。');
      if (result?.draw) {
        this.pendingDraw = null; clearPendingMemberAction('draw');
        if (!this.disposed) this.setData({ result: result.draw, lotteries: this.data.overview.lotteries.map(item => ({ ...item, canAttempt: item.canDraw, retryPending: false })) });
      } else if (!this.disposed) {
        const failure = this.lastOperationError;
        // The server checks the request receipt before these rejection gates.
        // A definite rejection has no draw; ambiguous transport failures retain it.
        if (failure?.statusCode >= 400 && failure.statusCode < 500 && ['MEMBER_OPERATIONS_DISABLED', 'POINTS_INSUFFICIENT', 'MEMBER_OPERATIONS_LIMIT_REACHED', 'MEMBER_OPERATIONS_NOT_FOUND', 'INVALID_MEMBER_OPERATION', 'MEMBER_OPERATIONS_COUPON_UNAVAILABLE'].includes(failure.message)) { this.pendingDraw = null; clearPendingMemberAction('draw'); }
        this.setData({ lotteries: this.data.lotteries.map(item => ({ ...item, retryPending: this.pendingDraw?.target === item.id, canAttempt: item.canDraw || (this.pendingDraw?.target === item.id) })) });
      }
    } catch (_error) { if (!this.disposed) this.setData({ error: '暂时无法打开确认窗口，请稍后重试。' }); }
    finally { this.confirmingDraw = false; if (!this.disposed) this.setData({ busy: false }); }
  },
}, ["goLogin","loadOperations","joinMember","openWallet","draw"]));
