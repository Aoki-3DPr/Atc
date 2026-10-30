#include <bits/stdc++.h>
#include "LazySegmentTree.cpp"
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};


ll solve() {
	ll n; cin >> n;
	vector<ll> aa(n + 1);
	for (ll i = 1; i < n + 1; i++) {
		cin >> aa[i];
	}
	vector<ll> dp(n + 1, LONG_LONG_MAX);
	stack<ll> mi, ma;
	LazySegment seg(n + 1, [](ll a, ll b){ return min(a, b); }, INT_MAX);
	dp[0] = 0;
	seg.set(0, 0);
	for (ll i = 1; i < n + 1; i++) {
		ll r = aa[i];
		ll r_index = i;
		ll l_index = i;
		while (!mi.empty()) {
			if (r < aa[mi.top()]) {
				r_index = mi.top();
				mi.pop();
				if (!mi.empty()) {
					l_index = mi.top();
				} else {
					l_index = 0;
				}
				seg.range_apply(l_index, r_index, 1, aa[r_index]);
			} else {
				break;
			}
		}
		if (!mi.empty()) {
			l_index = mi.top();
		} else {
			l_index = 0;
		}
		if (l_index < i) {
			seg.range_apply(l_index, i, 1, -aa[i]);
		}
		mi.push(i);

		l_index = i;
		while (!ma.empty()) {
			if (r > aa[ma.top()]) {
				r_index = ma.top();
				ma.pop();
				if (!ma.empty()) {
					l_index = ma.top();
				} else {
					l_index = 0;
				}
				seg.range_apply(l_index, r_index, 1, -aa[r_index]);
			} else {
				break;
			}
		}
		if (!ma.empty()) {
				l_index = ma.top();
			} else {
				l_index = 0;
			}
		if (l_index < i) {
			seg.range_apply(l_index, i, 1, aa[i]);
		}
		ma.push(i);
		dp[i] = seg.query(0, i - 1);
		seg.set(i, dp[i]);
	}
	cout << dp[n] << endl;
	return 0;
}

int main() {
	solve();

    return 0;
}
