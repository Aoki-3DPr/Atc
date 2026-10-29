#include <bits/stdc++.h>
#define ll long long
using namespace std;
int di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
int dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(int i, int j, int h, int w) { return 0 <= j && j < w && 0 <= i && i < h; }


ll solve() {
	ll n, m, k;
	cin >> n >> m >> k;
	vector<ll> v(n);
	for (ll i = 0; i < n; i++) cin >> v[i];
	ll sum = 0;
	for (ll i = 0; i < n; i++) {
		if (i - m + 1 > 0) {
			sum -= v[i - m];
		}
		if (sum + v[i] <= k) {
			sum += v[i];
			cout << "Yes" << endl;
		} else {
			cout << "No" << endl;
		}
		cout << sum << endl;
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
