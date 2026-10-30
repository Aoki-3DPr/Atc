#include <bits/stdc++.h>
#define ll long long
using namespace std;
ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(ll i, ll j, ll h, ll w) { return 0 <= j && j < w && 0 <= i && i < h; }

ll mod = 998244353;

ll num(pair<ll, ll>& p) {
	if (p.first > 0 && p.second >= 0) return 0;
	else if (p.first <= 0 && p.second > 0) return 1;
	else if (p.first < 0 && p.second <= 0) return 2;
	else return 3;
}

ll kurosu(pair<ll, ll>& a, pair<ll, ll>& b) {
	return a.first * b.second - b.first * a.second;
}

bool compare(pair<ll, ll>& a, pair<ll, ll>& b) {
	if (num(a) < num(b)) return true;
	else if (num(a) > num(b)) return false;
	if (kurosu(a, b) > 0) return true;
	else return false;
}

int solve() {
	ll t; cin >> t;

	while (t--) {
		ll n; cin >> n;
		vector<pair<ll, ll>> a(n);
		for (ll i = 0; i < n; i++) {
			ll x, y; cin >> x >> y;
			a[i] = {x, y};
		}
		sort(a.begin(), a.end(), compare);
		ll ans = 0;
		ll j = 1;
		for (ll i = 0; i < n; i++) {
			if (i >= j) j = i + 1;
			while (kurosu(a[i], a[j % n]) > 0) j++;
			ans = max(ans, j - i);
		}
		cout << ans << endl;
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
