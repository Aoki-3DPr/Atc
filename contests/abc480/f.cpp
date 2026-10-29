#include <bits/stdc++.h>
#define ll long long
using namespace std;

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

int main() {
	ll n, m; cin >> n >> m;
	vector<ll> a(n);
	vector<ll> sum(1 << n);
	ll s = 0;
	for (ll i = 0; i < n; i++) {
		cin >> a[i];
		s += a[i];
	}
	s /= m;
	for (ll i = 1; i < 1 << n; i++) {
		for (ll j = 0; j < n; j++) {
			if (i & (1 << j)) {
				sum[i] += a[j];
			}
		}
	}
	vector<ll> dp(1 << n, 0);
	for (ll i = 0; i < 1 << n; i++) {
		for (ll j = 0; j < n; j++) {
			if (!(i & (1 << j))) {
				dp[i ^ (1 << j)] = max(dp[i ^ (1 << j)], dp[i] + (sum[i ^ (1 << j)] % s == 0));
			}
		}
	}
	cout << m - dp[(1 << n) - 1] << endl;
    return 0;
}
