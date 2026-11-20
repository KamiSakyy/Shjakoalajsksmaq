/** Кошелёк игрока: наличные, банк и история операций для приложения «Банк». */
export interface Transaction {
  id: number;
  label: string;
  amount: number;
  at: number;
}

export class Economy {
  cash = 420;
  bank = 1250;
  robbed = 0;
  earned = 0;
  spent = 0;
  history: Transaction[] = [];
  private seq = 1;
  onChange?: () => void;

  get total() { return this.cash + this.bank; }

  add(amount: number, label: string) {
    const value = Math.round(amount);
    if (!value) return;
    this.cash += value;
    this.earned += Math.max(0, value);
    this.history.unshift({ id: this.seq++, label, amount: value, at: Date.now() });
    if (this.history.length > 40) this.history.pop();
    this.onChange?.();
  }

  spend(amount: number, label: string) {
    const value = Math.round(amount);
    if (value <= 0) return true;
    if (this.cash < value) return false;
    this.cash -= value;
    this.spent += value;
    this.history.unshift({ id: this.seq++, label, amount: -value, at: Date.now() });
    if (this.history.length > 40) this.history.pop();
    this.onChange?.();
    return true;
  }

  deposit(amount: number) {
    const value = Math.min(Math.round(amount), this.cash);
    if (value <= 0) return false;
    this.cash -= value;
    this.bank += value;
    this.history.unshift({ id: this.seq++, label: 'Вклад в банк', amount: -value, at: Date.now() });
    this.onChange?.();
    return true;
  }

  withdraw(amount: number) {
    const value = Math.min(Math.round(amount), this.bank);
    if (value <= 0) return false;
    this.bank -= value;
    this.cash += value;
    this.history.unshift({ id: this.seq++, label: 'Снятие в банкомате', amount: value, at: Date.now() });
    this.onChange?.();
    return true;
  }

  reset() {
    this.cash = 420; this.bank = 1250; this.robbed = 0; this.earned = 0; this.spent = 0;
    this.history = [];
    this.onChange?.();
  }
}

export const formatMoney = (n: number) => `$${Math.round(n).toLocaleString('ru-RU')}`;
