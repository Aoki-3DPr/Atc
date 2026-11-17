#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<ll> a(n);
	for (ll i = 0; i < n; i++) cin >> a[i];
	vector<ll> b(n + 1);
	vector<pair<ll, ll>> m(n + 1);
	ll mi = 0;
	ll ma = 0;
	for (ll i = 1; i <= n; i++) {
		b[i] = a[i - 1] + b[i - 1];
		mi = min(mi, b[i]);
		ma = max(ma, b[i]);
		m[i] = {mi, ma};
	}
	vector<pair<ll, ll>> c(n + 2, {INT_MAX, INT_MIN});
	for (ll i = n; i > 0; i--) {
		c[i]= {min(c[i + 1].first, b[i]), max(c[i + 1].second, b[i])};
	}
	ll ans = ma - mi + 1;
	for (ll i = 0; i < n; i++) {
		ll mii = m[i].first, maa = m[i].second;
		maa = max(maa, c[i + 1].second - a[i] * 2);
		mii = min(mii, c[i + 1].first - a[i] * 2);
		ans = max(ans, maa - mii + 1);
	}

	cout << ans << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

