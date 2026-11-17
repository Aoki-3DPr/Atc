#include <bits/stdc++.h>
#include "SegmentTree.cpp"
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, l, r; cin >> n >> l >> r;
	vector<ll> a(n);
	vector<ll> s(n + 1);
	vector<ll> ss(n, 1);
	SegmentTree seg(n, [](ll i, ll j) { return i + j; }, 0);
	seg.setall(ss);
	vector<ll> index(n);
	vector<ll> index2(n);
	ll mi = LONG_LONG_MAX, ma = LONG_LONG_MIN;
	for (ll i = 0; i < n; i++) {
		cin >> a[i];
		s[i + 1] = s[i] + a[i];
		if (l <= s[i + 1] && s[i + 1] <= r) {
			mi = min(mi, s[i + 1]);
			ma = max(ma, s[i + 1]);
		}
		index[i] = i;
		index2[i] = i;
		ss[i] = s[i + 1];
	}
	ll ans = 0;
	sort(index.begin(), index.end(), [&](ll i, ll j) {return ss[i] < ss[j];});
	sort(index2.begin(), index2.end(), [&](ll i, ll j) {return index[i] < index[j];});
	sort(ss.begin(), ss.end());
	for (ll i = 0; i < n; i++) {
		auto it_l = lower_bound(ss.begin(), ss.end(), l);
		auto it_r = upper_bound(ss.begin(), ss.end(), r);
		ans += seg.query(it_l - ss.begin(), it_r - ss.begin());
		l += a[i];
		r += a[i];
		seg.apply(index2[i], 0, 0);
	}
	cout << ans << endl;
	return 0;
}

int main() {
	solve();
	return 0;
}

